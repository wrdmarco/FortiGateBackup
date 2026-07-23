"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditLog } from "@/lib/audit";
import { requirePermission, tenantFilter } from "@/lib/authz";
import { FORTIOS_PARSER_VERSION } from "@/lib/security/fortios-parser";
import { saveFoundryConfig } from "@/lib/security/foundry-config";
import { SECURITY_RULESET_VERSION } from "@/lib/security/rules";
import { tenantTransaction } from "@/lib/tenant-db";

export async function saveFoundryConfigAction(formData:FormData){const user=await requirePermission("security.foundry.manage");const tenantId=tenantFilter(user);if(!tenantId||tenantId!==String(formData.get("tenantId")??""))throw new Error("Ongeldige tenantcontext.");try{await saveFoundryConfig({tenantId,userId:user.id,enabled:formData.getAll("enabled").some((value)=>value==="true"),endpoint:String(formData.get("endpoint")??""),deployment:String(formData.get("deployment")??""),apiKey:String(formData.get("apiKey")??"").trim()||undefined});}catch(error){const code=error instanceof Error?error.message:"";if(code==="INVALID_FOUNDRY_ENDPOINT")redirect("/settings?tab=foundry&error=invalid-endpoint");if(code==="INVALID_FOUNDRY_DEPLOYMENT")redirect("/settings?tab=foundry&error=invalid-deployment");if(code==="FOUNDRY_API_KEY_REQUIRED")redirect("/settings?tab=foundry&error=missing-key");throw error;}revalidatePath("/settings");redirect("/settings?tab=foundry&saved=1");}
export async function deleteFoundryConfigAction(formData:FormData){const user=await requirePermission("security.foundry.manage");const tenantId=tenantFilter(user);if(!tenantId||tenantId!==String(formData.get("tenantId")??""))throw new Error("Ongeldige tenantcontext.");await tenantTransaction(tenantId,(tx)=>tx.tenantFoundryConfig.deleteMany({where:{tenantId}}));await auditLog({action:"foundry.config.removed",tenantId,userId:user.id,entity:"TenantFoundryConfig",entityId:tenantId});revalidatePath("/settings");redirect("/settings?tab=foundry");}
export async function retryAnalysisAction(formData:FormData){const user=await requirePermission("security.analyses.run");const tenantId=tenantFilter(user);const analysisId=String(formData.get("analysisId")??"");if(!tenantId)throw new Error("Tenantcontext ontbreekt.");await tenantTransaction(tenantId,async(tx)=>{const analysis=await tx.securityAnalysis.findFirstOrThrow({where:{id:analysisId,tenantId}});if(analysis.status==="COMPLETED")return;await tx.securityAnalysis.update({where:{id:analysis.id},data:{status:"PENDING",errorCode:null}});await tx.securityAnalysisJob.update({where:{analysisId:analysis.id},data:{status:"PENDING",availableAt:new Date(),attempts:0,errorCode:null,finishedAt:null,workerId:null,leaseExpiresAt:null}});});await auditLog({action:"security.analysis.retry_requested",tenantId,userId:user.id,entity:"SecurityAnalysis",entityId:analysisId});revalidatePath("/security");}

export async function startSecurityAnalysisAction(formData: FormData) {
  const user = await requirePermission("security.analyses.run");
  const tenantId = tenantFilter(user);
  const fortigateId = String(formData.get("fortigateId") ?? "");
  if (!tenantId || !fortigateId) throw new Error("Ongeldige tenant- of FortiGatecontext.");

  const result = await tenantTransaction(tenantId, async (tx) => {
    const foundry = await tx.tenantFoundryConfig.findFirst({
      where: {
        tenantId,
        enabled: true,
        endpoint: { not: "" },
        deployment: { not: "" },
        apiKeyEncrypted: { not: "" },
        tenant: { kind: "CUSTOMER", active: true }
      },
      select: { deployment: true }
    });
    if (!foundry) return { kind: "not-configured" as const };

    const backup = await tx.backup.findFirst({
      where: {
        tenantId,
        fortigateId,
        status: "CHANGED",
        configArtifactId: { not: null },
        fortigate: { customer: { tenantId } }
      },
      orderBy: { createdAt: "desc" },
      include: { configArtifact: { include: { analysis: true } } }
    });
    if (!backup?.configArtifact || !backup.sha256) return { kind: "no-config" as const };
    if (backup.configArtifact.analysis) {
      return { kind: "existing" as const, analysisId: backup.configArtifact.analysis.id };
    }

    const analysis = await tx.securityAnalysis.upsert({
      where: {
        tenantId_fortigateId_configSha256: {
          tenantId,
          fortigateId,
          configSha256: backup.sha256
        }
      },
      create: {
        tenantId,
        fortigateId,
        configArtifactId: backup.configArtifact.id,
        configSha256: backup.sha256,
        sourceBackupId: backup.id,
        parserVersion: FORTIOS_PARSER_VERSION,
        rulesetVersion: SECURITY_RULESET_VERSION,
        promptVersion: "1.0.0",
        foundryDeployment: foundry.deployment
      },
      update: {}
    });
    await tx.securityAnalysisJob.upsert({
      where: { analysisId: analysis.id },
      create: { tenantId, fortigateId, analysisId: analysis.id },
      update: {}
    });
    return { kind: "created" as const, analysisId: analysis.id };
  }, { isolationLevel: "Serializable" });

  if (result.kind === "not-configured") redirect("/security?error=reporting-not-configured");
  if (result.kind === "no-config") redirect("/security?error=no-changed-config");
  if (result.kind === "created") {
    await auditLog({
      action: "security.analysis.started",
      tenantId,
      userId: user.id,
      entity: "SecurityAnalysis",
      entityId: result.analysisId,
      metadata: { trigger: "manual" }
    });
  }
  revalidatePath("/security");
  redirect(`/security/analyses/${result.analysisId}`);
}
export async function setFindingDispositionAction(formData:FormData){const user=await requirePermission("security.findings.review");const tenantId=tenantFilter(user);const findingId=String(formData.get("findingId")??"");const kind=String(formData.get("kind")??"");if(!tenantId||!["ACCEPTED_RISK","ACKNOWLEDGED","FALSE_POSITIVE","SUPPRESSED"].includes(kind))throw new Error("Ongeldige beoordeling.");await tenantTransaction(tenantId,async(tx)=>{await tx.securityFinding.findFirstOrThrow({where:{id:findingId,tenantId}});await tx.securityFindingDisposition.upsert({where:{tenantId_findingId:{tenantId,findingId}},create:{tenantId,findingId,kind:kind as "ACKNOWLEDGED",createdById:user.id},update:{kind:kind as "ACKNOWLEDGED",createdById:user.id}});});await auditLog({action:"security.finding.disposition_changed",tenantId,userId:user.id,entity:"SecurityFinding",entityId:findingId,metadata:{kind}});revalidatePath("/security");}
