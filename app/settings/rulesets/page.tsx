import { SecurityRulesetStatus } from "@prisma/client";
import { notFound } from "next/navigation";
import { createRulesetDraftAction } from "./actions";
import { ActionLink, Badge, Button, PageHeader, Panel, Shell, TableShell } from "@/components/ui";
import { requirePermission, tenantFilter } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { isGlobalTenantId } from "@/lib/tenant-main";

export const dynamic="force-dynamic";
export default async function RulesetsPage(){
  const user=await requirePermission("platform.security.rulesets.read");
  if(!user.tenantId||!(await isGlobalTenantId(user.tenantId))||!(await isGlobalTenantId(tenantFilter(user))))notFound();
  const canManage=await import("@/lib/rbac").then(({hasPermission})=>hasPermission(user,"platform.security.rulesets.manage"));
  const rulesets=await prisma.securityRuleset.findMany({include:{_count:{select:{rules:true}}},orderBy:{createdAt:"desc"}});
  return <Shell>
    <PageHeader title="Beveiligingsrulesets" description="Beheer versieerbare, deterministische FortiGate-controles. Gepubliceerde versies en bestaande analyses blijven immutable." actions={<ActionLink href="/settings?tab=rulesets">Terug naar instellingen</ActionLink>}/>
    {canManage?<Panel title="Nieuwe conceptversie" description="De actieve ruleset wordt volledig gekopieerd. Publiceren is een afzonderlijke, gecontroleerde handeling.">
      <form action={createRulesetDraftAction} className="grid gap-4 md:grid-cols-[12rem_minmax(18rem,1fr)_auto]">
        <label className="grid gap-1.5 text-sm"><span className="font-medium">Versie</span><input required pattern="[0-9]+\.[0-9]+\.[0-9]+" name="version" placeholder="2.1.0" className="min-h-11 rounded-lg border border-border bg-surface px-3"/></label>
        <label className="grid gap-1.5 text-sm"><span className="font-medium">Wijzigingsreden</span><input required minLength={3} maxLength={500} name="changeReason" className="min-h-11 rounded-lg border border-border bg-surface px-3"/></label>
        <Button className="self-end" type="submit">Concept maken</Button>
      </form>
    </Panel>:null}
    <TableShell className="mt-5"><table className="table-pro w-full min-w-[760px] text-left text-sm"><thead><tr><th>Versie</th><th>Status</th><th>Regels</th><th>Reden</th><th>Gepubliceerd</th><th>Actie</th></tr></thead><tbody>
      {rulesets.map((ruleset)=><tr key={ruleset.id} className="border-t border-border"><td className="font-mono font-semibold">{ruleset.version}</td><td><Badge tone={ruleset.status===SecurityRulesetStatus.ACTIVE?"success":ruleset.status===SecurityRulesetStatus.DRAFT?"warning":"neutral"}>{ruleset.status}</Badge></td><td>{ruleset._count.rules}</td><td>{ruleset.changeReason}</td><td>{ruleset.publishedAt?.toLocaleString("nl-NL")??"-"}</td><td><ActionLink href={`/settings/rulesets/${ruleset.id}`}>{ruleset.status==="DRAFT"&&canManage?"Bewerken":"Bekijken"}</ActionLink></td></tr>)}
    </tbody></table></TableShell>
  </Shell>;
}
