import type { SecurityRule, SecurityRuleset } from "@prisma/client";
import { deleteRuleAction, saveRuleAction } from "../../actions";
import { ActionLink, Badge, Button, Panel } from "@/components/ui";
import type { RuleCondition } from "@/lib/security/rules";
import { RULE_FIELD_ALLOWLIST, RULE_PATH_ALLOWLIST } from "@/lib/security/ruleset";

export function RuleForm({ruleset,rule,canManage=true}:{ruleset:SecurityRuleset;rule:SecurityRule|null;canManage?:boolean}){
  const editable=canManage&&ruleset.status==="DRAFT";
  let conditions:RuleCondition[]=[];try{conditions=rule?.conditions?JSON.parse(rule.conditions):[];}catch{}
  const rows=Array.from({length:Math.max(3,conditions.length)},(_,index)=>conditions[index]);
  return <div className="grid gap-5">
    {rule?.evaluator==="BUILTIN"?<div className="rounded-lg border border-amber-300/50 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"><Badge tone="warning">Ingebouwde detector</Badge><p className="mt-2">De detectielogica staat vast in productiecode. Tekst, severity, gewicht en activatie zijn binnen dit concept aanpasbaar.</p></div>:null}
    <form action={saveRuleAction} className="grid gap-5">
      <input type="hidden" name="rulesetId" value={ruleset.id}/>{rule?<input type="hidden" name="existingId" value={rule.id}/>:null}
      <Panel title="Identiteit en score"><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Rule-ID"><input disabled={!editable||rule?.evaluator==="BUILTIN"} required name="ruleId" defaultValue={rule?.ruleId??""} pattern="FG-[A-Z0-9]+-[0-9]{3}"/>{rule?.evaluator==="BUILTIN"?<input type="hidden" name="ruleId" value={rule.ruleId}/>:null}</Field>
        <Field label="Categorie"><input disabled={!editable} required name="category" defaultValue={rule?.category??""}/></Field>
        <Field label="Severity"><select disabled={!editable} name="severity" defaultValue={rule?.severity??"MEDIUM"}>{["CRITICAL","HIGH","MEDIUM","LOW"].map((value)=><option key={value}>{value}</option>)}</select></Field>
        <Field label="Gewicht (1-100)"><input disabled={!editable} required type="number" min={1} max={100} name="weight" defaultValue={rule?.weight??5}/></Field>
        <label className="flex min-h-11 items-center gap-2 self-end text-sm font-medium"><input disabled={!editable} type="checkbox" name="enabled" value="true" defaultChecked={rule?.enabled??true}/> Regel actief</label>
      </div></Panel>
      <Panel title="Nederlandse rapporttekst"><div className="grid gap-4">
        <Field label="Titel"><input disabled={!editable} required name="title" defaultValue={rule?.title??""}/></Field>
        <Field label="Uitleg"><textarea disabled={!editable} required name="explanation" defaultValue={rule?.explanation??""}/></Field>
        <Field label="Veilig hersteladvies"><textarea disabled={!editable} required name="remediation" defaultValue={rule?.remediation??""}/></Field>
        <Field label="Positieve informatietekst"><input disabled={!editable} required name="positiveTitle" defaultValue={rule?.positiveTitle??""}/></Field>
      </div></Panel>
      {rule?.evaluator!=="BUILTIN"?<Panel title="Declaratieve detector" description="Alle ingevulde voorwaarden moeten waar zijn. Alleen geparseerde FortiOS-velden worden lokaal beoordeeld.">
        <Field label="FortiOS-configuratiesectie"><select disabled={!editable} required name="configPath" defaultValue={rule?.configPath??"system interface"}>{RULE_PATH_ALLOWLIST.map((value)=><option key={value}>{value}</option>)}</select></Field>
        <div className="mt-4 grid gap-3">{rows.map((condition,index)=><div className="grid gap-3 md:grid-cols-[1fr_13rem_1fr]" key={index}>
          <Field label={`Veld ${index+1}`}><select disabled={!editable} name="conditionField" defaultValue={condition?.field??""}><option value="">Niet gebruikt</option>{RULE_FIELD_ALLOWLIST.map((value)=><option key={value}>{value}</option>)}</select></Field>
          <Field label="Operator"><select disabled={!editable} name="conditionOperator" defaultValue={condition?.operator??"CONTAINS"}>{["EQUALS","CONTAINS","NOT_CONTAINS","EXISTS","NOT_EXISTS","COUNT_GT"].map((value)=><option key={value}>{value}</option>)}</select></Field>
          <Field label="Waarde"><input disabled={!editable} name="conditionValue" defaultValue={condition?.value??""}/></Field>
        </div>)}</div>
      </Panel>:null}
      {editable?<div className="flex flex-wrap gap-2"><Button type="submit">Regel opslaan</Button><ActionLink href={`/settings/rulesets/${ruleset.id}`}>Annuleren</ActionLink></div>:<ActionLink href={`/settings/rulesets/${ruleset.id}`}>Terug</ActionLink>}
    </form>
    {editable&&rule?<form action={deleteRuleAction} className="border-t border-border pt-5"><input type="hidden" name="rulesetId" value={ruleset.id}/><input type="hidden" name="ruleId" value={rule.id}/><Button variant="danger" type="submit">Regel uit concept verwijderen</Button></form>:null}
  </div>;
}

function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="grid gap-1.5 text-sm"><span className="font-medium">{label}</span><span className="[&>input]:min-h-11 [&>input]:w-full [&>input]:rounded-lg [&>input]:border [&>input]:border-border [&>input]:bg-surface [&>input]:px-3 [&>select]:min-h-11 [&>select]:w-full [&>select]:rounded-lg [&>select]:border [&>select]:border-border [&>select]:bg-surface [&>select]:px-3 [&>textarea]:min-h-24 [&>textarea]:w-full [&>textarea]:rounded-lg [&>textarea]:border [&>textarea]:border-border [&>textarea]:bg-surface [&>textarea]:p-3">{children}</span></label>;}
