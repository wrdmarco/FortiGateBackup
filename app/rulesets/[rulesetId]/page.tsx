import { SecurityRulesetStatus } from "@prisma/client";
import { notFound } from "next/navigation";
import { moveRuleAction, publishRulesetAction } from "../actions";
import { ActionLink, Badge, Button, Card, PageHeader, Panel, Shell } from "@/components/ui";
import { requirePermission, tenantFilter } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { hasPermission } from "@/lib/rbac";
import { isGlobalTenantId } from "@/lib/tenant-main";

export default async function RulesetBuilderPage({params}:{params:Promise<{rulesetId:string}>}){
  const user=await requirePermission("platform.security.rulesets.read");
  if(!user.tenantId||!(await isGlobalTenantId(user.tenantId))||!(await isGlobalTenantId(tenantFilter(user))))notFound();
  const {rulesetId}=await params;
  const [ruleset,canManage]=await Promise.all([
    prisma.securityRuleset.findUnique({where:{id:rulesetId},include:{rules:{orderBy:[{sortOrder:"asc"},{ruleId:"asc"}]}}}),
    hasPermission(user,"platform.security.rulesets.manage")
  ]);
  if(!ruleset)notFound();
  const editable=canManage&&ruleset.status===SecurityRulesetStatus.DRAFT;
  const enabled=ruleset.rules.filter((rule)=>rule.enabled);
  const declarative=ruleset.rules.filter((rule)=>rule.evaluator==="DECLARATIVE").length;
  return <Shell>
    <PageHeader title={`Ruleset-builder ${ruleset.version}`} description={ruleset.changeReason} actions={<><ActionLink href="/rulesets">Alle versies</ActionLink>{editable?<ActionLink variant="primary" href={`/rulesets/${ruleset.id}/rules/new`}>Regel toevoegen</ActionLink>:null}</>}/>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card title="Status" value={ruleset.status==="DRAFT"?"Concept":ruleset.status==="ACTIVE"?"Actief":"Historisch"} detail={editable?"Bewerkbaar":"Immutable"}/>
      <Card title="Actieve regels" value={`${enabled.length} / ${ruleset.rules.length}`} detail={`${ruleset.rules.length-enabled.length} uitgeschakeld`}/>
      <Card title="Declaratieve regels" value={declarative} detail={`${ruleset.rules.length-declarative} ingebouwde detectors`}/>
      <Card title="Totaal gewicht" value={enabled.reduce((sum,rule)=>sum+rule.weight,0)} detail="Van alle actieve regels"/>
    </div>
    <Panel className="mt-5" title="Publicatiecontrole" description="Publiceren maakt deze volledige versie immutable. Lopende en historische analyses behouden altijd hun oorspronkelijke rulesetversie.">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={enabled.length?"success":"danger"}>{enabled.length?`${enabled.length} actieve regels gereed`:"Geen actieve regels"}</Badge>
        <span className="text-sm text-muted-foreground">{ruleset.rules.filter((rule)=>rule.severity==="CRITICAL"&&rule.enabled).length} critical, {ruleset.rules.filter((rule)=>rule.severity==="HIGH"&&rule.enabled).length} high, {ruleset.rules.filter((rule)=>rule.severity==="MEDIUM"&&rule.enabled).length} medium, {ruleset.rules.filter((rule)=>rule.severity==="LOW"&&rule.enabled).length} low</span>
        {editable?<form className="ml-auto" action={publishRulesetAction}><input type="hidden" name="rulesetId" value={ruleset.id}/><Button disabled={!enabled.length} type="submit">Valideren en publiceren</Button></form>:null}
      </div>
    </Panel>
    <section className="mt-5" aria-labelledby="rules-heading">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3"><div><h2 id="rules-heading" className="font-display text-xl font-semibold">Regelvolgorde</h2><p className="mt-1 text-sm text-muted-foreground">De volgorde bepaalt de presentatie in de builder. Elke regel blijft via de stabiele Rule-ID traceerbaar.</p></div>{editable?<ActionLink href={`/rulesets/${ruleset.id}/rules/new`}>Nieuwe regel</ActionLink>:null}</div>
      <div className="grid gap-3">
        {ruleset.rules.map((rule,index)=><article key={rule.id} className="rounded-[0.625rem] border border-border bg-surface p-4 shadow-panel">
          <div className="grid gap-4 xl:grid-cols-[3.5rem_minmax(0,1fr)_11rem_9rem_auto] xl:items-center">
            <div className="font-mono text-sm font-semibold text-muted-foreground">{String(index+1).padStart(2,"0")}</div>
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs font-semibold text-primary">{rule.ruleId}</span><Badge tone={rule.enabled?"success":"neutral"}>{rule.enabled?"Actief":"Uit"}</Badge><Badge tone={severityTone(rule.severity)}>{rule.severity}</Badge></div><h3 className="mt-2 font-semibold">{rule.title}</h3><p className="mt-1 text-sm text-muted-foreground">{rule.category} - {rule.evaluator==="DECLARATIVE"?`${rule.configPath} met ${conditionCount(rule.conditions)} voorwaarden`:"Ingebouwde lokale detector"}</p></div>
            <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Scoregewicht</p><p className="mt-1 font-display text-xl font-semibold">{rule.weight}</p></div>
            {editable?<div className="flex gap-2"><MoveButton rulesetId={ruleset.id} ruleId={rule.id} direction="UP" disabled={index===0}>Omhoog</MoveButton><MoveButton rulesetId={ruleset.id} ruleId={rule.id} direction="DOWN" disabled={index===ruleset.rules.length-1}>Omlaag</MoveButton></div>:<span/>}
            <ActionLink href={`/rulesets/${ruleset.id}/rules/${rule.id}`}>{editable?"Bewerken":"Details"}</ActionLink>
          </div>
        </article>)}
        {!ruleset.rules.length?<div className="rounded-lg border border-dashed border-border bg-surface p-10 text-center"><p className="font-semibold">Dit concept bevat nog geen regels.</p>{editable?<ActionLink href={`/rulesets/${ruleset.id}/rules/new`} variant="primary">Eerste regel toevoegen</ActionLink>:null}</div>:null}
      </div>
    </section>
  </Shell>;
}

function MoveButton({rulesetId,ruleId,direction,disabled,children}:{rulesetId:string;ruleId:string;direction:"UP"|"DOWN";disabled:boolean;children:React.ReactNode}){
  return <form action={moveRuleAction}><input type="hidden" name="rulesetId" value={rulesetId}/><input type="hidden" name="ruleId" value={ruleId}/><input type="hidden" name="direction" value={direction}/><Button className="min-h-9 px-2 text-xs" disabled={disabled} type="submit" variant="secondary">{children}</Button></form>;
}
function conditionCount(value:string|null){try{const parsed=JSON.parse(value??"[]");return Array.isArray(parsed)?parsed.length:0;}catch{return 0;}}
function severityTone(severity:string):"neutral"|"warning"|"danger"{return severity==="CRITICAL"||severity==="HIGH"?"danger":severity==="MEDIUM"?"warning":"neutral";}
