"use client";

import type { SecurityRule, SecurityRuleset } from "@prisma/client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { deleteRuleAction, saveRuleAction } from "../../actions";
import type { RuleCondition } from "@/lib/security/rules";
import { RULE_FIELD_ALLOWLIST, RULE_PATH_ALLOWLIST } from "@/lib/security/ruleset";

const operators=["EQUALS","CONTAINS","NOT_CONTAINS","EXISTS","NOT_EXISTS","COUNT_GT"] as const;
type BuilderCondition={id:number;field:string;operator:typeof operators[number];value:string};

export function RuleForm({ruleset,rule,canManage=true}:{ruleset:SecurityRuleset;rule:SecurityRule|null;canManage?:boolean}){
  const editable=canManage&&ruleset.status==="DRAFT";
  const initialConditions=useMemo(()=>parseConditions(rule?.conditions),[rule?.conditions]);
  const [conditions,setConditions]=useState<BuilderCondition[]>(initialConditions.length?initialConditions:[emptyCondition(1)]);
  const [configPath,setConfigPath]=useState(rule?.configPath??"system interface");
  const [severity,setSeverity]=useState<string>(rule?.severity??"MEDIUM");
  const [weight,setWeight]=useState(rule?.weight??5);
  const declarative=rule?.evaluator!=="BUILTIN";
  return <div className="grid gap-5">
    <Panel title="Builderstatus" description="De builder accepteert uitsluitend geallowliste FortiOS-secties, velden en operators. Vrije code, scripts en configuratietekst zijn niet toegestaan.">
      <div className="flex flex-wrap gap-2"><Badge tone={editable?"warning":"neutral"}>{editable?"Concept - bewerkbaar":"Alleen-lezen"}</Badge><Badge>{declarative?"Declaratieve detector":"Ingebouwde detector"}</Badge><Badge tone={severity==="CRITICAL"||severity==="HIGH"?"danger":severity==="MEDIUM"?"warning":"neutral"}>{severity}</Badge><Badge>Gewicht {weight}</Badge></div>
    </Panel>
    {rule?.evaluator==="BUILTIN"?<div className="rounded-lg border border-amber-300/50 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"><Badge tone="warning">Ingebouwde detector</Badge><p className="mt-2">De detectielogica staat vast in productiecode. Tekst, severity, gewicht en activatie zijn binnen dit concept aanpasbaar.</p></div>:null}
    <form action={saveRuleAction} className="grid gap-5">
      <input type="hidden" name="rulesetId" value={ruleset.id}/>{rule?<input type="hidden" name="existingId" value={rule.id}/>:null}
      <Panel title="1. Identiteit en score" description="Gebruik een stabiele Rule-ID. Het gewicht bepaalt de lokale technische score; Azure kan dit nooit wijzigen."><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Rule-ID" help="Formaat FG-CATEGORIE-001"><input disabled={!editable||rule?.evaluator==="BUILTIN"} required name="ruleId" defaultValue={rule?.ruleId??""} pattern="FG-[A-Z0-9]+-[0-9]{3}"/>{rule?.evaluator==="BUILTIN"?<input type="hidden" name="ruleId" value={rule.ruleId}/>:null}</Field>
        <Field label="Categorie"><input disabled={!editable} required minLength={2} maxLength={100} name="category" defaultValue={rule?.category??""}/></Field>
        <Field label="Severity"><select disabled={!editable} name="severity" value={severity} onChange={(event)=>setSeverity(event.target.value)}>{["CRITICAL","HIGH","MEDIUM","LOW"].map((value)=><option key={value}>{value}</option>)}</select></Field>
        <Field label="Gewicht" help="1 tot 100 gewogen punten"><input disabled={!editable} required type="number" min={1} max={100} name="weight" value={weight} onChange={(event)=>setWeight(Number(event.target.value))}/></Field>
        <label className="flex min-h-11 items-center gap-3 self-end rounded-lg border border-border bg-surface-soft px-3 text-sm font-medium"><input disabled={!editable} type="checkbox" name="enabled" value="true" defaultChecked={rule?.enabled??true}/> Regel actief</label>
      </div></Panel>
      <Panel title="2. Nederlandse rapporttekst" description="Deze veilige teksten verschijnen lokaal in de analyse en het immutable PDF-rapport. Gebruik geen secrets of configuratiefragmenten."><div className="grid gap-4">
        <Field label="Titel" help="Noem het FortiGate-object of risico, niet de interne rulesetnaam."><input disabled={!editable} required minLength={3} maxLength={200} name="title" defaultValue={rule?.title??""}/></Field>
        <Field label="Uitleg"><textarea disabled={!editable} required minLength={3} maxLength={2000} name="explanation" defaultValue={rule?.explanation??""}/></Field>
        <Field label="Veilig hersteladvies"><textarea disabled={!editable} required minLength={3} maxLength={2000} name="remediation" defaultValue={rule?.remediation??""}/></Field>
        <Field label="Positieve informatietekst" help="Wordt als INFO getoond wanneer toepasselijke controles slagen."><input disabled={!editable} required minLength={3} maxLength={200} name="positiveTitle" defaultValue={rule?.positiveTitle??""}/></Field>
      </div></Panel>
      {declarative?<Panel title="3. Detectielogica" description="ALS een geparseerd FortiOS-object in deze sectie aan ALLE voorwaarden voldoet, DAN wordt de bevinding aangemaakt.">
        <Field label="FortiOS-configuratiesectie"><select disabled={!editable} required name="configPath" value={configPath} onChange={(event)=>setConfigPath(event.target.value)}>{RULE_PATH_ALLOWLIST.map((value)=><option key={value}>{value}</option>)}</select></Field>
        <div className="mt-5 grid gap-3">
          {conditions.map((condition,index)=><div className="rounded-lg border border-border bg-surface-soft p-4" key={condition.id}>
            <div className="mb-3 flex items-center justify-between gap-3"><p className="text-sm font-semibold">Voorwaarde {index+1}</p>{editable&&conditions.length>1?<button className="min-h-11 rounded-lg px-3 text-sm font-semibold text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950" type="button" onClick={()=>setConditions((current)=>current.filter((item)=>item.id!==condition.id))}>Verwijderen</button>:null}</div>
            <div className="grid gap-3 lg:grid-cols-[1fr_13rem_1fr]">
              <Field label="Geparsed veld"><select disabled={!editable} required name="conditionField" value={condition.field} onChange={(event)=>updateCondition(setConditions,condition.id,{field:event.target.value})}>{RULE_FIELD_ALLOWLIST.map((value)=><option key={value}>{value}</option>)}</select></Field>
              <Field label="Operator"><select disabled={!editable} name="conditionOperator" value={condition.operator} onChange={(event)=>updateCondition(setConditions,condition.id,{operator:event.target.value as BuilderCondition["operator"]})}>{operators.map((value)=><option key={value}>{operatorLabel(value)}</option>)}</select></Field>
              <Field label="Waarde" help={condition.operator==="EXISTS"||condition.operator==="NOT_EXISTS"?"Niet gebruikt door deze operator":condition.operator==="COUNT_GT"?"Geheel getal":"Exacte geparseerde waarde"}><input disabled={!editable||condition.operator==="EXISTS"||condition.operator==="NOT_EXISTS"} required={condition.operator!=="EXISTS"&&condition.operator!=="NOT_EXISTS"} name="conditionValue" value={condition.value} onChange={(event)=>updateCondition(setConditions,condition.id,{value:event.target.value})}/></Field>
            </div>
          </div>)}
          {editable&&conditions.length<5?<Button className="w-fit" type="button" variant="secondary" onClick={()=>setConditions((current)=>[...current,emptyCondition(Math.max(...current.map((item)=>item.id))+1)])}>Voorwaarde toevoegen</Button>:null}
        </div>
        <div className="mt-5 rounded-lg border border-primary/25 bg-primary/5 p-4"><p className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">Leesbare preview</p><p className="mt-2 text-sm leading-6">ALS <strong>{configPath}</strong> {conditions.map((condition)=>`${condition.field} ${operatorLabel(condition.operator).toLowerCase()}${condition.value?` "${condition.value}"`:""}`).join(" EN ")}, DAN maak een <strong>{severity}</strong>-bevinding met gewicht <strong>{weight}</strong>.</p></div>
      </Panel>:null}
      {editable?<div className="sticky bottom-4 z-10 flex flex-wrap gap-2 rounded-xl border border-border bg-surface/95 p-3 shadow-panel backdrop-blur"><Button type="submit">Regel opslaan</Button><ActionLink href={`/rulesets/${ruleset.id}`}>Annuleren</ActionLink></div>:<ActionLink href={`/rulesets/${ruleset.id}`}>Terug naar ruleset</ActionLink>}
    </form>
    {editable&&rule?<form action={deleteRuleAction} className="border-t border-border pt-5"><input type="hidden" name="rulesetId" value={ruleset.id}/><input type="hidden" name="ruleId" value={rule.id}/><Button variant="danger" type="submit">Regel uit concept verwijderen</Button></form>:null}
  </div>;
}

function Field({label,help,children}:{label:string;help?:string;children:React.ReactNode}){return <label className="grid gap-1.5 text-sm"><span className="font-medium">{label}</span><span className="[&>input]:min-h-11 [&>input]:w-full [&>input]:rounded-lg [&>input]:border [&>input]:border-border [&>input]:bg-surface [&>input]:px-3 [&>input]:outline-none [&>input]:focus:border-primary [&>input]:focus:ring-2 [&>input]:focus:ring-primary/15 [&>select]:min-h-11 [&>select]:w-full [&>select]:rounded-lg [&>select]:border [&>select]:border-border [&>select]:bg-surface [&>select]:px-3 [&>textarea]:min-h-28 [&>textarea]:w-full [&>textarea]:rounded-lg [&>textarea]:border [&>textarea]:border-border [&>textarea]:bg-surface [&>textarea]:p-3">{children}</span>{help?<span className="text-xs leading-5 text-muted-foreground">{help}</span>:null}</label>;}
function emptyCondition(id:number):BuilderCondition{return{id,field:"action",operator:"EQUALS",value:""};}
function parseConditions(value:string|null|undefined):BuilderCondition[]{try{const parsed:RuleCondition[]=value?JSON.parse(value):[];return parsed.map((condition,index)=>({id:index+1,field:condition.field,operator:condition.operator,value:String(condition.value??"")}));}catch{return[];}}
function updateCondition(setter:React.Dispatch<React.SetStateAction<BuilderCondition[]>>,id:number,patch:Partial<BuilderCondition>){setter((current)=>current.map((condition)=>condition.id===id?{...condition,...patch}:condition));}
function operatorLabel(operator:BuilderCondition["operator"]){return({EQUALS:"is exact gelijk aan",CONTAINS:"bevat",NOT_CONTAINS:"bevat niet",EXISTS:"bestaat",NOT_EXISTS:"ontbreekt",COUNT_GT:"aantal groter dan"} as const)[operator];}
function Panel({title,description,children}:{title:string;description?:string;children:React.ReactNode}){return <section className="overflow-hidden rounded-[0.625rem] border border-border bg-surface shadow-panel"><div className="border-b border-border px-5 py-4"><h2 className="font-display text-base font-semibold">{title}</h2>{description?<p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>:null}</div><div className="p-5">{children}</div></section>;}
function Badge({children,tone="neutral"}:{children:React.ReactNode;tone?:"neutral"|"success"|"warning"|"danger"}){const classes={neutral:"border-border bg-muted text-muted-foreground",success:"border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",warning:"border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",danger:"border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"};return <span className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-semibold ${classes[tone]}`}>{children}</span>;}
function Button({children,variant="primary",className="",...props}:{children:React.ReactNode;variant?:"primary"|"secondary"|"danger";className?:string}&React.ButtonHTMLAttributes<HTMLButtonElement>){const classes={primary:"bg-primary text-primary-foreground hover:bg-primary/90",secondary:"border border-border bg-surface hover:border-primary/45 hover:bg-muted",danger:"border border-red-300 bg-surface text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"};return <button className={`inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${classes[variant]} ${className}`} {...props}>{children}</button>;}
function ActionLink({children,href}:{children:React.ReactNode;href:string}){return <Link className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold transition hover:border-primary/45 hover:bg-muted" href={href}>{children}</Link>;}
