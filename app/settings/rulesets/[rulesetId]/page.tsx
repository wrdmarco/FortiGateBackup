import { SecurityRulesetStatus } from "@prisma/client";
import { notFound } from "next/navigation";
import { publishRulesetAction } from "../actions";
import { ActionLink, Badge, Button, PageHeader, Panel, Shell, TableShell } from "@/components/ui";
import { requirePermission, tenantFilter } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { hasPermission } from "@/lib/rbac";
import { isGlobalTenantId } from "@/lib/tenant-main";

export default async function RulesetPage({params}:{params:Promise<{rulesetId:string}>}){
  const user=await requirePermission("platform.security.rulesets.read");
  if(!user.tenantId||!(await isGlobalTenantId(user.tenantId))||!(await isGlobalTenantId(tenantFilter(user))))notFound();
  const {rulesetId}=await params;
  const [ruleset,canManage]=await Promise.all([prisma.securityRuleset.findUnique({where:{id:rulesetId},include:{rules:{orderBy:[{sortOrder:"asc"},{ruleId:"asc"}]}}}),hasPermission(user,"platform.security.rulesets.manage")]);
  if(!ruleset)notFound();
  const editable=canManage&&ruleset.status===SecurityRulesetStatus.DRAFT;
  return <Shell>
    <PageHeader title={`Ruleset ${ruleset.version}`} description={ruleset.changeReason} actions={<><ActionLink href="/settings/rulesets">Alle versies</ActionLink>{editable?<ActionLink variant="primary" href={`/settings/rulesets/${ruleset.id}/rules/new`}>Regel toevoegen</ActionLink>:null}</>}/>
    <Panel><div className="flex flex-wrap items-center gap-3"><Badge tone={ruleset.status==="ACTIVE"?"success":ruleset.status==="DRAFT"?"warning":"neutral"}>{ruleset.status}</Badge><span className="text-sm text-muted-foreground">{ruleset.rules.filter((rule)=>rule.enabled).length} actieve regels</span>{editable?<form className="ml-auto" action={publishRulesetAction}><input type="hidden" name="rulesetId" value={ruleset.id}/><Button type="submit">Valideren en publiceren</Button></form>:null}</div></Panel>
    <TableShell className="mt-5"><table className="table-pro w-full min-w-[980px] text-left text-sm"><thead><tr><th>Rule-ID</th><th>Status</th><th>Categorie</th><th>Severity</th><th>Gewicht</th><th>Evaluator</th><th>Titel</th><th>Actie</th></tr></thead><tbody>
      {ruleset.rules.map((rule)=><tr key={rule.id} className="border-t border-border"><td className="font-mono font-semibold">{rule.ruleId}</td><td><Badge tone={rule.enabled?"success":"neutral"}>{rule.enabled?"Actief":"Uit"}</Badge></td><td>{rule.category}</td><td><Badge tone={rule.severity==="CRITICAL"||rule.severity==="HIGH"?"danger":rule.severity==="MEDIUM"?"warning":"neutral"}>{rule.severity}</Badge></td><td>{rule.weight}</td><td>{rule.evaluator}</td><td>{rule.title}</td><td><ActionLink href={`/settings/rulesets/${ruleset.id}/rules/${rule.id}`}>{editable?"Bewerken":"Bekijken"}</ActionLink></td></tr>)}
    </tbody></table></TableShell>
  </Shell>;
}
