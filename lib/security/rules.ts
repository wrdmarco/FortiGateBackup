import type { ParsedFortiOsConfig } from "./fortios-parser";

export const SECURITY_RULESET_VERSION = "1.0.0";
export type LocalFinding = { ruleId: string; category: string; severity: "CRITICAL"|"HIGH"|"MEDIUM"|"LOW"; penalty: number; title: string; explanation: string; evidence: string; remediation: string };

const definitions = {
  "FG-POL-001": ["Firewallbeleid", "CRITICAL", 18, "Any-to-any beleid", "Een accepterend beleid is te breed.", "Beperk bron, bestemming en service tot wat functioneel nodig is."],
  "FG-POL-002": ["Firewallbeleid", "HIGH", 8, "Bron is all", "Het beleid accepteert verkeer vanaf iedere bron.", "Gebruik specifieke bronobjecten."],
  "FG-POL-003": ["Firewallbeleid", "HIGH", 8, "Bestemming is all", "Het beleid accepteert verkeer naar iedere bestemming.", "Gebruik specifieke bestemmingsobjecten."],
  "FG-POL-004": ["Firewallbeleid", "HIGH", 8, "Service is onbeperkt", "Het beleid staat alle services toe.", "Sta alleen benodigde services toe."],
  "FG-LOG-001": ["Logging", "MEDIUM", 5, "Logging ontbreekt", "Een accepterend beleid logt verkeer niet.", "Schakel all-sessions logging in."],
  "FG-MGT-001": ["Beheer", "CRITICAL", 16, "Telnet-beheer actief", "Telnet biedt geen transportversleuteling.", "Verwijder telnet uit allowaccess."],
  "FG-MGT-002": ["Beheer", "HIGH", 10, "HTTP-beheer actief", "HTTP-beheer is onbeveiligd.", "Gebruik uitsluitend HTTPS voor webbeheer."],
  "FG-MGT-003": ["Beheer", "HIGH", 10, "Breed beheer op publieke interface", "Een publieke interface staat beheerprotocollen toe.", "Beperk beheer tot een dedicated managementnetwerk en trusted hosts."],
  "FG-UTM-001": ["Security profiles", "MEDIUM", 6, "Securityprofielen ontbreken", "Een accepterend internetbeleid heeft geen zichtbaar securityprofiel.", "Activeer passende AV-, IPS- en webfilterprofielen."],
  "FG-VPN-001": ["VPN", "HIGH", 10, "Risicovolle VPN-crypto", "De VPN gebruikt een verouderde of zwakke cryptografische instelling.", "Gebruik actuele IKE- en sterke encryptie-instellingen."],
  "FG-GRP-001": ["Objecten", "LOW", 3, "Overmatig brede groep", "Een objectgroep bevat uitzonderlijk veel leden.", "Splits groepen op functionele zone of toepassing."]
} as const;

export function evaluateFortiOs(parsed: ParsedFortiOsConfig) {
  const findings: LocalFinding[] = [];
  for (const node of parsed.nodes) {
    const v = node.values;
    if (node.path.endsWith("firewall policy") && first(v.action) === "accept") {
      const srcAll = includes(v.srcaddr, "all"); const dstAll = includes(v.dstaddr, "all"); const svcAll = includes(v.service, "ALL") || includes(v.service, "ANY");
      if (srcAll && dstAll && svcAll) add(findings,"FG-POL-001",node);
      else { if(srcAll)add(findings,"FG-POL-002",node); if(dstAll)add(findings,"FG-POL-003",node); if(svcAll)add(findings,"FG-POL-004",node); }
      if (!includes(v.logtraffic,"all") && !includes(v.logtraffic,"utm")) add(findings,"FG-LOG-001",node);
      if (!["av-profile","ips-sensor","webfilter-profile","application-list"].some((key)=>v[key]?.length)) add(findings,"FG-UTM-001",node);
    }
    if (node.path.endsWith("system interface")) {
      const access=(v.allowaccess??[]).map((x)=>x.toLowerCase());
      if(access.includes("telnet"))add(findings,"FG-MGT-001",node);
      if(access.includes("http"))add(findings,"FG-MGT-002",node);
      if((first(v.role)==="wan" || first(v.mode)==="dhcp") && access.some((x)=>["https","ssh","http","telnet"].includes(x)))add(findings,"FG-MGT-003",node);
    }
    if (node.path.endsWith("vpn ipsec phase1-interface") && [...(v.proposal??[]),...(v.dhgrp??[])].some((x)=>/des|md5|(^|\D)[12](\D|$)/i.test(x))) add(findings,"FG-VPN-001",node);
    if ((node.path.endsWith("firewall addrgrp") || node.path.endsWith("firewall service group")) && (v.member?.length??0)>50) add(findings,"FG-GRP-001",node);
  }
  const score=Math.max(0,100-findings.reduce((sum,item)=>sum+item.penalty,0));
  return { findings, score };
}
function add(target:LocalFinding[],id:keyof typeof definitions,node:ParsedFortiOsConfig["nodes"][number]){const [category,severity,penalty,title,explanation,remediation]=definitions[id];target.push({ruleId:id,category,severity,penalty,title,explanation,evidence:`${node.path}; object=${stableToken(node.path,node.edit??"global")}; vdom=${stableToken("vdom",node.vdom)}`,remediation});}
function stableToken(type:string,value:string){let hash=0;for(const c of `${type}:${value}`)hash=(hash*31+c.charCodeAt(0))>>>0;return `${type.replace(/\W/g,"_").toUpperCase()}_${hash}`;}
function first(values:readonly string[]|undefined){return values?.[0]?.toLowerCase();}
function includes(values:readonly string[]|undefined,value:string){return Boolean(values?.some((item)=>item.toLowerCase()===value.toLowerCase()));}
