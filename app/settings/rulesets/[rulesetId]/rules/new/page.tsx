import { notFound } from "next/navigation";
import { RuleForm } from "../rule-form";
import { PageHeader, Shell } from "@/components/ui";
import { requirePermission, tenantFilter } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { isGlobalTenantId } from "@/lib/tenant-main";

export default async function NewRulePage({params}:{params:Promise<{rulesetId:string}>}){
  const user=await requirePermission("platform.security.rulesets.manage");if(!user.tenantId||!(await isGlobalTenantId(user.tenantId))||!(await isGlobalTenantId(tenantFilter(user))))notFound();
  const {rulesetId}=await params;const ruleset=await prisma.securityRuleset.findUnique({where:{id:rulesetId}});if(!ruleset||ruleset.status!=="DRAFT")notFound();
  return <Shell><PageHeader title="Beveiligingsregel toevoegen" description={`Concept-ruleset ${ruleset.version}`}/><RuleForm ruleset={ruleset} rule={null}/></Shell>;
}
