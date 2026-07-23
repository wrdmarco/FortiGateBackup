"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditLog } from "@/lib/audit";
import { requirePermission, tenantFilter } from "@/lib/authz";
import { createRulesetDraft, deleteDraftRule, publishRuleset, saveDraftRule } from "@/lib/security/ruleset";
import type { RuleCondition } from "@/lib/security/rules";
import { isGlobalTenantId } from "@/lib/tenant-main";

async function globalRulesetAdmin(){
  const user=await requirePermission("platform.security.rulesets.manage");
  const tenantId=tenantFilter(user);
  if(!user.tenantId||!(await isGlobalTenantId(user.tenantId))||!(await isGlobalTenantId(tenantId)))throw new Error("Rulesetbeheer is uitsluitend beschikbaar in de Global-context.");
  return {user,tenantId:tenantId!};
}

export async function createRulesetDraftAction(formData:FormData){
  const {user,tenantId}=await globalRulesetAdmin();
  const draft=await createRulesetDraft({version:String(formData.get("version")??""),changeReason:String(formData.get("changeReason")??""),createdById:user.id});
  await auditLog({action:"security.ruleset.draft_created",tenantId,userId:user.id,entity:"SecurityRuleset",entityId:draft.id,metadata:{version:draft.version}});
  redirect(`/settings/rulesets/${draft.id}`);
}

export async function saveRuleAction(formData:FormData){
  const {user,tenantId}=await globalRulesetAdmin();
  const rulesetId=String(formData.get("rulesetId")??"");
  const conditionFields=formData.getAll("conditionField").map(String);
  const conditionOperators=formData.getAll("conditionOperator").map(String);
  const conditionValues=formData.getAll("conditionValue").map(String);
  const conditions:RuleCondition[]=conditionFields.flatMap((field,index)=>{
    if(!field.trim())return[];
    const operator=conditionOperators[index] as RuleCondition["operator"];
    const raw=conditionValues[index]??"";
    return [{field:field.trim().toLowerCase(),operator,value:operator==="COUNT_GT"?Number(raw):raw}];
  });
  const rule=await saveDraftRule({
    rulesetId,existingId:String(formData.get("existingId")??"")||undefined,ruleId:String(formData.get("ruleId")??""),
    enabled:formData.get("enabled")==="true",category:String(formData.get("category")??""),severity:String(formData.get("severity")??""),
    weight:Number(formData.get("weight")),title:String(formData.get("title")??""),explanation:String(formData.get("explanation")??""),
    remediation:String(formData.get("remediation")??""),positiveTitle:String(formData.get("positiveTitle")??""),
    configPath:String(formData.get("configPath")??""),conditions
  });
  await auditLog({action:"security.ruleset.rule_saved",tenantId,userId:user.id,entity:"SecurityRule",entityId:rule.id,metadata:{rulesetId,ruleId:rule.ruleId}});
  revalidatePath(`/settings/rulesets/${rulesetId}`);
  redirect(`/settings/rulesets/${rulesetId}`);
}

export async function deleteRuleAction(formData:FormData){
  const {user,tenantId}=await globalRulesetAdmin();
  const rulesetId=String(formData.get("rulesetId")??"");const ruleId=String(formData.get("ruleId")??"");
  await deleteDraftRule(rulesetId,ruleId);
  await auditLog({action:"security.ruleset.rule_deleted",tenantId,userId:user.id,entity:"SecurityRule",entityId:ruleId,metadata:{rulesetId}});
  revalidatePath(`/settings/rulesets/${rulesetId}`);
}

export async function publishRulesetAction(formData:FormData){
  const {user,tenantId}=await globalRulesetAdmin();
  const rulesetId=String(formData.get("rulesetId")??"");
  const published=await publishRuleset(rulesetId);
  await auditLog({action:"security.ruleset.published",tenantId,userId:user.id,entity:"SecurityRuleset",entityId:published.id,metadata:{version:published.version}});
  revalidatePath("/settings");
  revalidatePath("/settings/rulesets");
  redirect("/settings/rulesets");
}
