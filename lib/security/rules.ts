import type { ParsedFortiOsConfig } from "./fortios-parser";

export const SECURITY_RULESET_VERSION = "2.0.0";
export type LocalFinding = { ruleId: string; category: string; severity: "CRITICAL"|"HIGH"|"MEDIUM"|"LOW"; penalty: number; title: string; explanation: string; evidence: string; remediation: string };
export type SecurityControlResult = { ruleId: string; weight: number; passed: boolean };
export type SecurityScoreComponent = { ruleId:string; category:string; title:string; passed:number; failed:number; earned:number; possible:number };

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

export function evaluateFortiOs(parsed: ParsedFortiOsConfig) {
  const findings: LocalFinding[] = [];
  const controls: SecurityControlResult[] = [];
  for (const node of parsed.nodes) {
    const v = node.values;
    if (node.path.endsWith("firewall policy") && first(v.action) === "accept") {
      const srcAll = includes(v.srcaddr, "all"); const dstAll = includes(v.dstaddr, "all"); const svcAll = includes(v.service, "ALL") || includes(v.service, "ANY");
      control(controls,"FG-POL-001",!(srcAll&&dstAll&&svcAll));
      control(controls,"FG-POL-002",!srcAll);
      control(controls,"FG-POL-003",!dstAll);
      control(controls,"FG-POL-004",!svcAll);
      if (srcAll && dstAll && svcAll) add(findings,"FG-POL-001",node);
      else { if(srcAll)add(findings,"FG-POL-002",node); if(dstAll)add(findings,"FG-POL-003",node); if(svcAll)add(findings,"FG-POL-004",node); }
      const loggingEnabled=includes(v.logtraffic,"all")||includes(v.logtraffic,"utm");
      control(controls,"FG-LOG-001",loggingEnabled);
      if (!loggingEnabled) add(findings,"FG-LOG-001",node);
      const profilesEnabled=["av-profile","ips-sensor","webfilter-profile","application-list"].some((key)=>v[key]?.length);
      control(controls,"FG-UTM-001",profilesEnabled);
      if (!profilesEnabled) add(findings,"FG-UTM-001",node);
    }
    if (node.path.endsWith("system interface")) {
      const access=(v.allowaccess??[]).map((x)=>x.toLowerCase());
      const telnetEnabled=access.includes("telnet");
      const httpEnabled=access.includes("http");
      control(controls,"FG-MGT-001",!telnetEnabled);
      control(controls,"FG-MGT-002",!httpEnabled);
      if(telnetEnabled)add(findings,"FG-MGT-001",node);
      if(httpEnabled)add(findings,"FG-MGT-002",node);
      const publicInterface=first(v.role)==="wan"||first(v.mode)==="dhcp";
      if(publicInterface){const publicManagement=access.some((x)=>["https","ssh","http","telnet"].includes(x));control(controls,"FG-MGT-003",!publicManagement);if(publicManagement)add(findings,"FG-MGT-003",node);}
    }
    if (node.path.endsWith("vpn ipsec phase1-interface")){const weak=[...(v.proposal??[]),...(v.dhgrp??[])].some((x)=>/des|md5|(^|\D)[12](\D|$)/i.test(x));control(controls,"FG-VPN-001",!weak);if(weak)add(findings,"FG-VPN-001",node);}
    if (node.path.endsWith("firewall addrgrp") || node.path.endsWith("firewall service group")){const broad=(v.member?.length??0)>50;control(controls,"FG-GRP-001",!broad);if(broad)add(findings,"FG-GRP-001",node);}
  }
  const scoring=calculateSecurityScore(controls);
  const scoreComponents:SecurityScoreComponent[]=scoring.components.map((component)=>{
    const definition=definitions[component.ruleId as keyof typeof definitions];
    return {...component,category:definition?.[0]??"Overig",title:definition?.[6]??component.ruleId};
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
      if(!definition||numbers.some((number)=>typeof number!=="number"||!Number.isFinite(number)||number<0))return[];
      return [{ruleId:item.ruleId as string,category:definition[0],title:definition[6],passed:numbers[0] as number,failed:numbers[1] as number,earned:numbers[2] as number,possible:numbers[3] as number}];
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
function control(target:SecurityControlResult[],id:keyof typeof definitions,passed:boolean){target.push({ruleId:id,weight:definitions[id][2],passed});}
function add(target:LocalFinding[],id:keyof typeof definitions,node:ParsedFortiOsConfig["nodes"][number]){const [category,severity,penalty,title,explanation,remediation]=definitions[id];target.push({ruleId:id,category,severity,penalty,title,explanation,evidence:`${node.path}; object=${stableToken(node.path,node.edit??"global")}; vdom=${stableToken("vdom",node.vdom)}`,remediation});}
function stableToken(type:string,value:string){let hash=0;for(const c of `${type}:${value}`)hash=(hash*31+c.charCodeAt(0))>>>0;return `${type.replace(/\W/g,"_").toUpperCase()}_${hash}`;}
function first(values:readonly string[]|undefined){return values?.[0]?.toLowerCase();}
function includes(values:readonly string[]|undefined,value:string){return Boolean(values?.some((item)=>item.toLowerCase()===value.toLowerCase()));}
