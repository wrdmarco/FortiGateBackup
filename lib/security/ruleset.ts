import { SecurityRuleEvaluator, SecurityRulesetStatus, SecuritySeverity } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { builtinRuntimeRules, type RuleCondition, type RuntimeSecurityRule } from "./rules";

export const RULE_FIELD_ALLOWLIST=["action","srcaddr","dstaddr","service","logtraffic","allowaccess","role","mode","proposal","dhgrp","member","status","nat","av-profile","ips-sensor","webfilter-profile","application-list"] as const;
export const RULE_PATH_ALLOWLIST=["system interface","system admin","firewall policy","firewall local-in-policy","firewall address","firewall addrgrp","firewall service custom","firewall service group","vpn ssl settings","vpn ipsec phase1-interface","log setting"] as const;
export const conditionSchema=z.object({
  field:z.enum(RULE_FIELD_ALLOWLIST),
  operator:z.enum(["EQUALS","CONTAINS","NOT_CONTAINS","EXISTS","NOT_EXISTS","COUNT_GT"]),
  value:z.union([z.string().max(200),z.number().int().min(0).max(10000)]).optional()
}).strict();
const conditionsSchema=z.array(conditionSchema).min(1).max(5);

export async function activeSecurityRuleset(version?:string|null){
  const ruleset=await prisma.securityRuleset.findFirst({where:version?{version}:{status:SecurityRulesetStatus.ACTIVE},include:{rules:{where:{enabled:true},orderBy:[{sortOrder:"asc"},{ruleId:"asc"}]}}});
  if(!ruleset)throw new Error("ACTIVE_RULESET_MISSING");
  const rules:RuntimeSecurityRule[]=ruleset.rules.map((rule)=>({
    ruleId:rule.ruleId,category:rule.category,severity:severity(rule.severity),weight:rule.weight,title:rule.title,
    explanation:rule.explanation,remediation:rule.remediation,positiveTitle:rule.positiveTitle,evaluator:rule.evaluator,
    ...(rule.configPath?{configPath:rule.configPath}:{}),
    ...(rule.conditions?{conditions:conditionsSchema.parse(JSON.parse(rule.conditions))}: {})
  }));
  if(!rules.length)throw new Error("ACTIVE_RULESET_EMPTY");
  return {id:ruleset.id,version:ruleset.version,rules};
}

export async function createRulesetDraft(input:{version:string;changeReason:string;createdById:string}){
  const version=z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/).parse(input.version.trim());
  const changeReason=z.string().trim().min(3).max(500).parse(input.changeReason);
  return prisma.$transaction(async(tx)=>{
    await tx.$executeRaw`SELECT set_config('app.global_ruleset_admin','1',true)`;
    const source=await tx.securityRuleset.findFirst({where:{status:SecurityRulesetStatus.ACTIVE},include:{rules:{orderBy:{sortOrder:"asc"}}}});
    const draft=await tx.securityRuleset.create({data:{version,changeReason,createdById:input.createdById}});
    const sourceRules=source?.rules??builtinRuntimeRules().map((rule,index)=>({...rule,id:`builtin-${index}`,enabled:true,sortOrder:(index+1)*10,configPath:null,conditions:null}));
    await tx.securityRule.createMany({data:sourceRules.map((rule)=>({
      rulesetId:draft.id,ruleId:rule.ruleId,enabled:rule.enabled,category:rule.category,severity:rule.severity,
      weight:rule.evaluator==="BUILTIN"&&"weight" in rule?rule.weight:rule.weight,title:rule.title,explanation:rule.explanation,
      remediation:rule.remediation,positiveTitle:rule.positiveTitle,evaluator:rule.evaluator,
      configPath:rule.configPath??null,conditions:rule.conditions??null,sortOrder:rule.sortOrder
    }))});
    return draft;
  },{isolationLevel:"Serializable"});
}

export async function saveDraftRule(input:{
  rulesetId:string;existingId?:string;ruleId:string;enabled:boolean;category:string;severity:string;weight:number;
  title:string;explanation:string;remediation:string;positiveTitle:string;configPath?:string;conditions?:RuleCondition[];
}){
  const text=(value:string,min:number,max:number)=>z.string().trim().min(min).max(max).parse(value);
  return prisma.$transaction(async(tx)=>{
    await tx.$executeRaw`SELECT set_config('app.global_ruleset_admin','1',true)`;
    const ruleset=await tx.securityRuleset.findUniqueOrThrow({where:{id:input.rulesetId}});
    if(ruleset.status!==SecurityRulesetStatus.DRAFT)throw new Error("RULESET_IMMUTABLE");
    const existing=input.existingId?await tx.securityRule.findFirstOrThrow({where:{id:input.existingId,rulesetId:input.rulesetId}}):null;
    const evaluator=existing?.evaluator??SecurityRuleEvaluator.DECLARATIVE;
    const data={
    ruleId:z.string().regex(/^FG-[A-Z0-9]+-[0-9]{3}$/).parse(input.ruleId.trim().toUpperCase()),
    enabled:input.enabled,category:text(input.category,2,100),severity:severity(z.nativeEnum(SecuritySeverity).parse(input.severity)),
    weight:z.number().int().min(1).max(100).parse(input.weight),title:text(input.title,3,200),
    explanation:text(input.explanation,3,2000),remediation:text(input.remediation,3,2000),positiveTitle:text(input.positiveTitle,3,200),
    evaluator,
    configPath:evaluator===SecurityRuleEvaluator.DECLARATIVE?z.enum(RULE_PATH_ALLOWLIST).parse(input.configPath?.trim()):null,
    conditions:evaluator===SecurityRuleEvaluator.DECLARATIVE?JSON.stringify(conditionsSchema.parse(input.conditions)):null
    };
    return existing
      ? tx.securityRule.update({where:{id:existing.id},data})
      : tx.securityRule.create({data:{...data,rulesetId:input.rulesetId,sortOrder:(await tx.securityRule.count({where:{rulesetId:input.rulesetId}})+1)*10}});
  },{isolationLevel:"Serializable"});
}

export async function deleteDraftRule(rulesetId:string,ruleId:string){
  await prisma.$transaction(async(tx)=>{
    await tx.$executeRaw`SELECT set_config('app.global_ruleset_admin','1',true)`;
    const ruleset=await tx.securityRuleset.findUniqueOrThrow({where:{id:rulesetId}});
    if(ruleset.status!==SecurityRulesetStatus.DRAFT)throw new Error("RULESET_IMMUTABLE");
    await tx.securityRule.deleteMany({where:{id:ruleId,rulesetId}});
  });
}

export async function moveDraftRule(rulesetId:string,ruleId:string,direction:"UP"|"DOWN"){
  await prisma.$transaction(async(tx)=>{
    await tx.$executeRaw`SELECT set_config('app.global_ruleset_admin','1',true)`;
    const ruleset=await tx.securityRuleset.findUniqueOrThrow({where:{id:rulesetId}});
    if(ruleset.status!==SecurityRulesetStatus.DRAFT)throw new Error("RULESET_IMMUTABLE");
    const rules=await tx.securityRule.findMany({where:{rulesetId},orderBy:[{sortOrder:"asc"},{ruleId:"asc"}],select:{id:true}});
    const index=rules.findIndex((rule)=>rule.id===ruleId);
    if(index<0)throw new Error("RULE_NOT_FOUND");
    const targetIndex=direction==="UP"?index-1:index+1;
    if(targetIndex<0||targetIndex>=rules.length)return;
    const ordered=[...rules];
    [ordered[index],ordered[targetIndex]]=[ordered[targetIndex],ordered[index]];
    for(const [position,rule] of ordered.entries()){
      await tx.securityRule.update({where:{id:rule.id},data:{sortOrder:(position+1)*10}});
    }
  },{isolationLevel:"Serializable"});
}

export async function publishRuleset(rulesetId:string){
  return prisma.$transaction(async(tx)=>{
    await tx.$executeRaw`SELECT set_config('app.global_ruleset_admin','1',true)`;
    const draft=await tx.securityRuleset.findUniqueOrThrow({where:{id:rulesetId},include:{rules:true}});
    if(draft.status!==SecurityRulesetStatus.DRAFT)throw new Error("RULESET_IMMUTABLE");
    if(!draft.rules.some((rule)=>rule.enabled))throw new Error("RULESET_EMPTY");
    for(const rule of draft.rules)if(rule.evaluator===SecurityRuleEvaluator.DECLARATIVE)conditionsSchema.parse(JSON.parse(rule.conditions??"null"));
    await tx.securityRuleset.updateMany({where:{status:SecurityRulesetStatus.ACTIVE},data:{status:SecurityRulesetStatus.RETIRED}});
    return tx.securityRuleset.update({where:{id:rulesetId},data:{status:SecurityRulesetStatus.ACTIVE,publishedAt:new Date()}});
  },{isolationLevel:"Serializable"});
}

function severity(value:SecuritySeverity):RuntimeSecurityRule["severity"]{
  if(value==="INFO")throw new Error("RULE_SEVERITY_INVALID");
  return value;
}
