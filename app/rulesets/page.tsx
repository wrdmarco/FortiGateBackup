import { SecurityRulesetStatus } from "@prisma/client";
import { notFound } from "next/navigation";
import { createRulesetDraftAction } from "./actions";
import { ActionLink, Badge, Button, Card, PageHeader, Panel, Shell, TableShell } from "@/components/ui";
import { requirePermission, tenantFilter } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { hasPermission } from "@/lib/rbac";
import { isGlobalTenantId } from "@/lib/tenant-main";

export const dynamic="force-dynamic";

export default async function RulesetsPage(){
  const user=await requirePermission("platform.security.rulesets.read");
  if(!user.tenantId||!(await isGlobalTenantId(user.tenantId))||!(await isGlobalTenantId(tenantFilter(user))))notFound();
  const [canManage,rulesets]=await Promise.all([
    hasPermission(user,"platform.security.rulesets.manage"),
    prisma.securityRuleset.findMany({include:{rules:{select:{enabled:true,weight:true,severity:true}}},orderBy:{createdAt:"desc"}})
  ]);
  const active=rulesets.find((ruleset)=>ruleset.status===SecurityRulesetStatus.ACTIVE);
  const drafts=rulesets.filter((ruleset)=>ruleset.status===SecurityRulesetStatus.DRAFT);
  const activeRules=active?.rules.filter((rule)=>rule.enabled)??[];
  return <Shell>
    <PageHeader title="Rulesets" description="Bouw, valideer en publiceer deterministische FortiGate-beveiligingsregels. Gepubliceerde versies en bestaande analyses blijven immutable."/>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card title="Actieve versie" value={active?.version??"Ontbreekt"} detail={active?`${activeRules.length} actieve regels`:"Analyses kunnen niet starten"}/>
      <Card title="Concepten" value={drafts.length} detail="Alleen concepten zijn bewerkbaar"/>
      <Card title="Actief scoregewicht" value={activeRules.reduce((sum,rule)=>sum+rule.weight,0)} detail="Gewogen punten per toepasselijke controle"/>
      <Card title="Hoogste ernst" value={activeRules.some((rule)=>rule.severity==="CRITICAL")?"Critical":activeRules.some((rule)=>rule.severity==="HIGH")?"High":"Geen"} detail="In de actieve ruleset"/>
    </div>
    {canManage?<Panel className="mt-5" title="Nieuwe conceptversie" description="Start met een volledige kopie van de actieve ruleset. Je kunt daarna regels ordenen, aanpassen, uitschakelen en uitbreiden.">
      <form action={createRulesetDraftAction} className="grid gap-4 lg:grid-cols-[12rem_minmax(20rem,1fr)_auto]">
        <label className="grid gap-1.5 text-sm"><span className="font-medium">Semantische versie</span><input required pattern="[0-9]+\.[0-9]+\.[0-9]+" name="version" placeholder="2.1.0" className="min-h-11 rounded-lg border border-border bg-surface px-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"/><span className="text-xs text-muted-foreground">Formaat: major.minor.patch</span></label>
        <label className="grid gap-1.5 text-sm"><span className="font-medium">Wijzigingsreden</span><input required minLength={3} maxLength={500} name="changeReason" placeholder="Beschrijf doel en impact van deze versie" className="min-h-11 rounded-lg border border-border bg-surface px-3 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"/></label>
        <Button className="self-start lg:mt-[1.625rem]" type="submit">Concept maken</Button>
      </form>
    </Panel>:null}
    <TableShell className="mt-5"><table className="table-pro w-full min-w-[820px] text-left text-sm"><thead><tr><th>Versie</th><th>Status</th><th>Regels</th><th>Actief</th><th>Gewicht</th><th>Wijzigingsreden</th><th>Gepubliceerd</th><th>Actie</th></tr></thead><tbody>
      {rulesets.length?rulesets.map((ruleset)=>{const enabled=ruleset.rules.filter((rule)=>rule.enabled);return <tr key={ruleset.id} className="border-t border-border"><td className="font-mono font-semibold">{ruleset.version}</td><td><Badge tone={ruleset.status===SecurityRulesetStatus.ACTIVE?"success":ruleset.status===SecurityRulesetStatus.DRAFT?"warning":"neutral"}>{statusLabel(ruleset.status)}</Badge></td><td>{ruleset.rules.length}</td><td>{enabled.length}</td><td>{enabled.reduce((sum,rule)=>sum+rule.weight,0)}</td><td className="max-w-md">{ruleset.changeReason}</td><td>{ruleset.publishedAt?.toLocaleString("nl-NL")??"-"}</td><td><ActionLink href={`/rulesets/${ruleset.id}`}>{ruleset.status==="DRAFT"&&canManage?"Open builder":"Bekijken"}</ActionLink></td></tr>}):<tr><td colSpan={8} className="py-10 text-center text-muted-foreground">Nog geen rulesets beschikbaar.</td></tr>}
    </tbody></table></TableShell>
  </Shell>;
}

function statusLabel(status:SecurityRulesetStatus){
  return status===SecurityRulesetStatus.ACTIVE?"Actief":status===SecurityRulesetStatus.DRAFT?"Concept":"Historisch";
}
