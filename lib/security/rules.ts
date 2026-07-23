import type { ParsedFortiOsConfig } from "./fortios-parser";

export const SECURITY_RULESET_VERSION = "2.0.0";
export type LocalFinding = { ruleId: string; category: string; severity: "CRITICAL"|"HIGH"|"MEDIUM"|"LOW"; penalty: number; title: string; explanation: string; evidence: string; remediation: string };
export type SecurityControlResult = { ruleId: string; weight: number; passed: boolean };
export type SecurityScoreComponent = { ruleId:string; category:string; title:string; passed:number; failed:number; earned:number; possible:number };
export type RuleCondition={field:string;operator:"EQUALS"|"CONTAINS"|"NOT_CONTAINS"|"EXISTS"|"NOT_EXISTS"|"COUNT_GT";value?:string|number};
export type RuntimeSecurityRule={ruleId:string;category:string;severity:"CRITICAL"|"HIGH"|"MEDIUM"|"LOW";weight:number;title:string;explanation:string;remediation:string;positiveTitle:string;evaluator:"BUILTIN"|"DECLARATIVE";configPath?:string;conditions?:RuleCondition[]};

const definitions = {
  "FG-POL-001": ["Firewallbeleid", "CRITICAL", 18, "Any-to-any beleid", "Een accepterend beleid is te breed.", "Beperk bron, bestemming en service tot wat functioneel nodig is.", "Geen volledig any-to-any beleid"],
  "FG-POL-002": ["Firewallbeleid", "HIGH", 8, "Bron is all", "Het beleid accepteert verkeer vanaf iedere bron.", "Gebruik specifieke bronobjecten.", "Bronnen zijn specifiek begrensd"],
  "FG-POL-003": ["Firewallbeleid", "HIGH", 8, "Bestemming is all", "Het beleid accepteert verkeer naar iedere bestemming.", "Gebruik specifieke bestemmingsobjecten.", "Bestemmingen zijn specifiek begrensd"],
  "FG-POL-004": ["Firewallbeleid", "HIGH", 8, "Service is onbeperkt", "Het beleid staat alle services toe.", "Sta alleen benodigde services toe.", "Services zijn specifiek begrensd"],
  "FG-LOG-001": ["Logging", "MEDIUM", 5, "Logging ontbreekt", "Een accepterend beleid logt verkeer niet.", "Schakel all-sessions logging in.", "Verkeerslogging is actief"],
  "FG-MGT-001": ["Beheer", "CRITICAL", 16, "Telnet-beheer actief", "Telnet biedt geen transportversleuteling.", "Verwijder telnet uit allowaccess.", "Telnet-beheer is uitgeschakeld"],
  "FG-MGT-002": ["Beheer", "HIGH", 10, "HTTP-beheer actief", "HTTP-beheer is onbeveiligd.", "Gebruik uitsluitend HTTPS voor webbeheer.", "HTTP-beheer is uitgeschakeld"],
  "FG-MGT-003": ["Beheer", "HIGH", 10, "Breed beheer op publieke interface", "Een publieke interface staat beheerprotocollen toe.", "Beperk beheer tot een dedicated managementnetwerk en trusted hosts.", "Publieke beheerblootstelling is geblokkeerd"],
  "FG-UTM-001": ["Security profiles", "MEDIUM", 6, "Securityprofielen ontbreken", "Een accepterend internetbeleid heeft geen zichtbaar securityprofiel.", "Activeer passende AV-, IPS- en webfilterprofielen.", "Securityprofielen zijn gekoppeld"],
  "FG-VPN-001": ["VPN", "HIGH", 10, "Risicovolle VPN-crypto", "De VPN gebruikt een verouderde of zwakke cryptografische instelling.", "Gebruik actuele IKE- en sterke encryptie-instellingen.", "VPN-cryptografie gebruikt geen herkende zwakke instelling"],
  "FG-GRP-001": ["Objecten", "LOW", 3, "Overmatig brede groep", "Een objectgroep bevat uitzonderlijk veel leden.", "Splits groepen op functionele zone of toepassing.", "Objectgroepen blijven binnen de breedtelimiet"]
} as const;

export function evaluateFortiOs(parsed: ParsedFortiOsConfig,configuredRules?:RuntimeSecurityRule[]) {
  const runtimeDefinitions=new Map((configuredRules??builtinRuntimeRules()).map((rule)=>[rule.ruleId,rule]));
  const findings: LocalFinding[] = [];
  const controls: SecurityControlResult[] = [];
  for (const node of parsed.nodes) {
    const v = node.values;
    if (node.path.endsWith("firewall policy") && first(v.action) === "accept") {
      const srcAll = includes(v.srcaddr, "all"); const dstAll = includes(v.dstaddr, "all"); const svcAll = includes(v.service, "ALL") || includes(v.service, "ANY");
      control(controls,runtimeDefinitions,"FG-POL-001",!(srcAll&&dstAll&&svcAll));
      control(controls,runtimeDefinitions,"FG-POL-002",!srcAll);
      control(controls,runtimeDefinitions,"FG-POL-003",!dstAll);
      control(controls,runtimeDefinitions,"FG-POL-004",!svcAll);
      if (srcAll && dstAll && svcAll) add(findings,runtimeDefinitions,"FG-POL-001",node);
      else { if(srcAll)add(findings,runtimeDefinitions,"FG-POL-002",node); if(dstAll)add(findings,runtimeDefinitions,"FG-POL-003",node); if(svcAll)add(findings,runtimeDefinitions,"FG-POL-004",node); }
      const loggingEnabled=includes(v.logtraffic,"all")||includes(v.logtraffic,"utm");
      control(controls,runtimeDefinitions,"FG-LOG-001",loggingEnabled);
      if (!loggingEnabled) add(findings,runtimeDefinitions,"FG-LOG-001",node);
      const profilesEnabled=["av-profile","ips-sensor","webfilter-profile","application-list"].some((key)=>v[key]?.length);
      control(controls,runtimeDefinitions,"FG-UTM-001",profilesEnabled);
      if (!profilesEnabled) add(findings,runtimeDefinitions,"FG-UTM-001",node);
    }
    if (node.path.endsWith("system interface")) {
      const access=(v.allowaccess??[]).map((x)=>x.toLowerCase());
      const telnetEnabled=access.includes("telnet");
      const httpEnabled=access.includes("http");
      control(controls,runtimeDefinitions,"FG-MGT-001",!telnetEnabled);
      control(controls,runtimeDefinitions,"FG-MGT-002",!httpEnabled);
      if(telnetEnabled)add(findings,runtimeDefinitions,"FG-MGT-001",node);
      if(httpEnabled)add(findings,runtimeDefinitions,"FG-MGT-002",node);
      const publicInterface=first(v.role)==="wan"||first(v.mode)==="dhcp";
      if(publicInterface){const publicManagement=access.some((x)=>["https","ssh","http","telnet"].includes(x));control(controls,runtimeDefinitions,"FG-MGT-003",!publicManagement);if(publicManagement)add(findings,runtimeDefinitions,"FG-MGT-003",node);}
    }
    if (node.path.endsWith("vpn ipsec phase1-interface")){const weak=[...(v.proposal??[]),...(v.dhgrp??[])].some((x)=>/des|md5|(^|\D)[12](\D|$)/i.test(x));control(controls,runtimeDefinitions,"FG-VPN-001",!weak);if(weak)add(findings,runtimeDefinitions,"FG-VPN-001",node);}
    if (node.path.endsWith("firewall addrgrp") || node.path.endsWith("firewall service group")){const broad=(v.member?.length??0)>50;control(controls,runtimeDefinitions,"FG-GRP-001",!broad);if(broad)add(findings,runtimeDefinitions,"FG-GRP-001",node);}
    for(const rule of runtimeDefinitions.values()){
      if(rule.evaluator!=="DECLARATIVE"||!rule.configPath||!node.path.endsWith(rule.configPath))continue;
      const failed=(rule.conditions??[]).every((condition)=>matchesCondition(node.values,condition));
      control(controls,runtimeDefinitions,rule.ruleId,!failed);
      if(failed)add(findings,runtimeDefinitions,rule.ruleId,node);
    }
  }
  const scoring=calculateSecurityScore(controls);
  const scoreComponents:SecurityScoreComponent[]=scoring.components.map((component)=>{
    const definition=runtimeDefinitions.get(component.ruleId);
    return {...component,category:definition?.category??"Overig",title:definition?.positiveTitle??component.ruleId};
  });
  return { findings, score:scoring.score, scoreComponents, passedControls:scoring.passed, totalControls:scoring.total };
}

export function parseStoredScoreComponents(value:string|null):SecurityScoreComponent[]{
  if(!value)return[];
  try{
    const parsed:unknown=JSON.parse(value);
    const components=typeof parsed==="object"&&parsed!==null&&"components" in parsed?(parsed as {components?:unknown}).components:null;
    if(!Array.isArray(components))return[];
    return components.flatMap((component)=>{
      if(typeof component!=="object"||component===null)return[];
      const item=component as Record<string,unknown>;
      const definition=typeof item.ruleId==="string"?definitions[item.ruleId as keyof typeof definitions]:undefined;
      const numbers=["passed","failed","earned","possible"].map((key)=>item[key]);
      if(typeof item.ruleId!=="string"||numbers.some((number)=>typeof number!=="number"||!Number.isFinite(number)||number<0))return[];
      const category=definition?.[0]??(typeof item.category==="string"?item.category.slice(0,100):"Overig");
      const title=definition?.[6]??(typeof item.title==="string"?item.title.slice(0,200):item.ruleId);
      return [{ruleId:item.ruleId,category,title,passed:numbers[0] as number,failed:numbers[1] as number,earned:numbers[2] as number,possible:numbers[3] as number}];
    });
  }catch{return[];}
}

export function calculateSecurityScore(controls: SecurityControlResult[]) {
  const grouped = new Map<string, { passed: number; failed: number; earned: number; possible: number }>();
  for (const result of controls) {
    const current = grouped.get(result.ruleId)??{passed:0,failed:0,earned:0,possible:0};
    current.possible+=result.weight;
    if(result.passed){current.passed+=1;current.earned+=result.weight;}else current.failed+=1;
    grouped.set(result.ruleId,current);
  }
  const components=[...grouped.entries()].map(([ruleId,value])=>({ruleId,...value}));
  const earned=components.reduce((sum,item)=>sum+item.earned,0);
  const possible=components.reduce((sum,item)=>sum+item.possible,0);
  return {score:possible?Math.round(earned/possible*100):100,passed:controls.filter((item)=>item.passed).length,total:controls.length,components};
}
function control(target:SecurityControlResult[],rules:Map<string,RuntimeSecurityRule>,id:string,passed:boolean){const rule=rules.get(id);if(rule)target.push({ruleId:id,weight:rule.weight,passed});}
function add(target:LocalFinding[],rules:Map<string,RuntimeSecurityRule>,id:string,node:ParsedFortiOsConfig["nodes"][number]){const rule=rules.get(id);if(!rule)return;const label=node.path.endsWith("firewall policy")?"Policy-ID":node.path.endsWith("system interface")?"Interface":node.path.endsWith("vpn ipsec phase1-interface")?"VPN":node.path.endsWith("firewall addrgrp")?"Adresgroep":node.path.endsWith("firewall service group")?"Servicegroep":"Object";target.push({ruleId:id,category:rule.category,severity:rule.severity,penalty:rule.weight,title:rule.title,explanation:rule.explanation,evidence:`Sectie: ${node.path}; ${label}: ${safeLocalIdentifier(node.edit??"global")}; VDOM: ${safeLocalIdentifier(node.vdom)}`,remediation:rule.remediation});}
export function builtinRuntimeRules():RuntimeSecurityRule[]{return Object.entries(definitions).map(([ruleId,value])=>({ruleId,category:value[0],severity:value[1],weight:value[2],title:value[3],explanation:value[4],remediation:value[5],positiveTitle:value[6],evaluator:"BUILTIN"}));}
function matchesCondition(values:Readonly<Record<string,readonly string[]>>,condition:RuleCondition){const actual=values[condition.field.toLowerCase()]??[];const expected=String(condition.value??"").toLowerCase();switch(condition.operator){case"EQUALS":return actual.length===1&&actual[0].toLowerCase()===expected;case"CONTAINS":return actual.some((value)=>value.toLowerCase()===expected);case"NOT_CONTAINS":return !actual.some((value)=>value.toLowerCase()===expected);case"EXISTS":return actual.length>0;case"NOT_EXISTS":return actual.length===0;case"COUNT_GT":return actual.length>Number(condition.value);}}
function safeLocalIdentifier(value:string){const clean=value.replace(/[\u0000-\u001f\u007f]/g," ").trim().slice(0,128);if(!clean||/-----BEGIN|(?:password|passwd|psk|secret|token|credential|community)|\bENC\b/i.test(clean)||/[A-Za-z0-9+/]{96,}={0,2}/.test(clean))return"[afgeschermd]";return clean;}
function first(values:readonly string[]|undefined){return values?.[0]?.toLowerCase();}
function includes(values:readonly string[]|undefined,value:string){return Boolean(values?.some((item)=>item.toLowerCase()===value.toLowerCase()));}
