import { notFound } from "next/navigation";
import { RuleForm } from "../rule-form";
import { ActionLink, PageHeader, Shell } from "@/components/ui";
import { requirePermission, tenantFilter } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { hasPermission } from "@/lib/rbac";
import { isGlobalTenantId } from "@/lib/tenant-main";

export default async function EditRulePage({params}:{params:Promise<{rulesetId:string;ruleId:string}>}){
  const user=await requirePermission("platform.security.rulesets.read");
  if(!user.tenantId||!(await isGlobalTenantId(user.tenantId))||!(await isGlobalTenantId(tenantFilter(user))))notFound();
  const {rulesetId,ruleId}=await params;
  const [ruleset,rule,canManage]=await Promise.all([
    prisma.securityRuleset.findUnique({where:{id:rulesetId}}),
    prisma.securityRule.findFirst({where:{id:ruleId,rulesetId}}),
    hasPermission(user,"platform.security.rulesets.manage")
  ]);
  if(!ruleset||!rule)notFound();
  return <Shell><PageHeader title={`${rule.ruleId} ${canManage&&ruleset.status==="DRAFT"?"bewerken":"bekijken"}`} description={`Ruleset ${ruleset.version}`} actions={<ActionLink href={`/rulesets/${ruleset.id}`}>Terug naar builder</ActionLink>}/><RuleForm ruleset={ruleset} rule={rule} canManage={canManage}/></Shell>;
}
