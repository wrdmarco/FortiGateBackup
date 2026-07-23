"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditLog } from "@/lib/audit";
import { requirePermission, tenantFilter } from "@/lib/authz";
import { FORTIOS_PARSER_VERSION } from "@/lib/security/fortios-parser";
import { saveFoundryConfig } from "@/lib/security/foundry-config";
import { tenantTransaction } from "@/lib/tenant-db";
import { isGlobalTenantId } from "@/lib/tenant-main";

export async function saveFoundryConfigAction(formData:FormData){const user=await requirePermission("security.foundry.manage");const tenantId=tenantFilter(user);if(!tenantId||tenantId!==String(formData.get("tenantId")??""))throw new Error("Ongeldige tenantcontext.");try{await saveFoundryConfig({tenantId,userId:user.id,enabled:formData.getAll("enabled").some((value)=>value==="true"),endpoint:String(formData.get("endpoint")??""),deployment:String(formData.get("deployment")??""),apiKey:String(formData.get("apiKey")??"").trim()||undefined});}catch(error){const code=error instanceof Error?error.message:"";if(code==="INVALID_FOUNDRY_ENDPOINT")redirect("/settings?tab=foundry&error=invalid-endpoint");if(code==="INVALID_FOUNDRY_DEPLOYMENT")redirect("/settings?tab=foundry&error=invalid-deployment");if(code==="FOUNDRY_API_KEY_REQUIRED")redirect("/settings?tab=foundry&error=missing-key");throw error;}revalidatePath("/settings");redirect("/settings?tab=foundry&saved=1");}
export async function deleteFoundryConfigAction(formData:FormData){const user=await requirePermission("security.foundry.manage");const tenantId=tenantFilter(user);if(!tenantId||tenantId!==String(formData.get("tenantId")??""))throw new Error("Ongeldige tenantcontext.");await tenantTransaction(tenantId,(tx)=>tx.tenantFoundryConfig.deleteMany({where:{tenantId}}));await auditLog({action:"foundry.config.removed",tenantId,userId:user.id,entity:"TenantFoundryConfig",entityId:tenantId});revalidatePath("/settings");redirect("/settings?tab=foundry");}
export async function retryAnalysisAction(formData:FormData){const user=await requirePermission("security.analyses.run");const tenantId=tenantFilter(user);const analysisId=String(formData.get("analysisId")??"");if(!tenantId)throw new Error("Tenantcontext ontbreekt.");await tenantTransaction(tenantId,async(tx)=>{const analysis=await tx.securityAnalysis.findFirstOrThrow({where:{id:analysisId,tenantId}});if(analysis.status==="COMPLETED")return;await tx.securityAnalysis.update({where:{id:analysis.id},data:{status:"PENDING",errorCode:null,parserVersion:FORTIOS_PARSER_VERSION}});const job=await tx.securityAnalysisJob.update({where:{analysisId:analysis.id},data:{status:"PENDING",availableAt:new Date(),attempts:0,errorCode:null,finishedAt:null,workerId:null,leaseExpiresAt:null}});await tx.securityAnalysisJobEvent.create({data:{tenantId,jobId:job.id,stage:"MANUAL_RETRY",message:"Een bevoegde gebruiker heeft de analyse opnieuw ingepland."}});});await auditLog({action:"security.analysis.retry_requested",tenantId,userId:user.id,entity:"SecurityAnalysis",entityId:analysisId});revalidatePath("/security");revalidatePath("/queue");}

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
    const ruleset=await tx.securityRuleset.findFirst({where:{status:"ACTIVE"},select:{version:true}});
    if(!ruleset)throw new Error("ACTIVE_RULESET_MISSING");

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
        rulesetVersion: ruleset.version,
        promptVersion: "1.0.0",
        foundryDeployment: foundry.deployment
      },
      update: {}
    });
    const analysisJob = await tx.securityAnalysisJob.upsert({
      where: { analysisId: analysis.id },
      create: { tenantId, fortigateId, analysisId: analysis.id, targetRulesetVersion:ruleset.version },
      update: {}
    });
    const eventCount = await tx.securityAnalysisJobEvent.count({ where: { tenantId, jobId: analysisJob.id } });
    if (!eventCount) {
      await tx.securityAnalysisJobEvent.create({
        data: { tenantId, jobId: analysisJob.id, stage: "QUEUED", message: "Handmatige analyse is veilig aan de queue toegevoegd." }
      });
    }
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

export async function reassessSecurityAnalysisAction(formData:FormData) {
  const user=await requirePermission("security.analyses.reassess");
  const tenantId=tenantFilter(user);
  const backupId=String(formData.get("backupId")??"");
  if(!tenantId||!backupId||!user.tenantId||!(await isGlobalTenantId(user.tenantId))||await isGlobalTenantId(tenantId))throw new Error("Herbeoordeling is uitsluitend toegestaan voor een Global-beheerder binnen een geselecteerde klanttenant.");
  const result=await tenantTransaction(tenantId,async(tx)=>{
    const backup=await tx.backup.findFirstOrThrow({
      where:{id:backupId,tenantId,status:"CHANGED",configArtifactId:{not:null}},
      include:{configArtifact:{include:{analysis:{include:{report:true,job:true}}}}}
    });
    const analysis=backup.configArtifact?.analysis;
    if(!analysis||analysis.status!=="COMPLETED"||!analysis.report)throw new Error("Alleen een voltooide analyse van een gewijzigde backup kan opnieuw worden beoordeeld.");
    const foundry=await tx.tenantFoundryConfig.findFirst({where:{tenantId,enabled:true,endpoint:{not:""},deployment:{not:""},apiKeyEncrypted:{not:""}},select:{deployment:true}});
    if(!foundry)throw new Error("REPORTING_NOT_CONFIGURED");
    const ruleset=await tx.securityRuleset.findFirst({where:{status:"ACTIVE"},select:{version:true}});
    if(!ruleset)throw new Error("ACTIVE_RULESET_MISSING");
    if(!analysis.job)throw new Error("ANALYSIS_JOB_MISSING");
    if(analysis.job.status==="PENDING"||analysis.job.status==="RUNNING")return {analysisId:analysis.id,jobId:analysis.job.id,queued:false};
    const job=await tx.securityAnalysisJob.update({
      where:{id:analysis.job.id},
      data:{status:"PENDING",reassessment:true,targetRulesetVersion:ruleset.version,attempts:0,availableAt:new Date(),workerId:null,leaseExpiresAt:null,heartbeatAt:null,errorCode:null,finishedAt:null}
    });
    await tx.securityAnalysisJobEvent.create({data:{tenantId,jobId:job.id,stage:"REASSESSMENT_QUEUED",message:"Global-beheerder heeft een veilige herbeoordeling ingepland; de bestaande analyse blijft beschikbaar tot de cutover."}});
    return {analysisId:analysis.id,jobId:job.id,queued:true};
  },{isolationLevel:"Serializable"});
  if(result.queued)await auditLog({action:"security.analysis.reassessment_requested",tenantId,userId:user.id,entity:"SecurityAnalysis",entityId:result.analysisId,metadata:{backupId,jobId:result.jobId}});
  revalidatePath("/queue");
  revalidatePath("/security");
  revalidatePath(`/security/analyses/${result.analysisId}`);
}
export async function setFindingDispositionAction(formData:FormData){const user=await requirePermission("security.findings.review");const tenantId=tenantFilter(user);const findingId=String(formData.get("findingId")??"");const kind=String(formData.get("kind")??"");if(!tenantId||!["ACCEPTED_RISK","ACKNOWLEDGED","FALSE_POSITIVE","SUPPRESSED"].includes(kind))throw new Error("Ongeldige beoordeling.");await tenantTransaction(tenantId,async(tx)=>{await tx.securityFinding.findFirstOrThrow({where:{id:findingId,tenantId}});await tx.securityFindingDisposition.upsert({where:{tenantId_findingId:{tenantId,findingId}},create:{tenantId,findingId,kind:kind as "ACKNOWLEDGED",createdById:user.id},update:{kind:kind as "ACKNOWLEDGED",createdById:user.id}});});await auditLog({action:"security.finding.disposition_changed",tenantId,userId:user.id,entity:"SecurityFinding",entityId:findingId,metadata:{kind}});revalidatePath("/security");}
