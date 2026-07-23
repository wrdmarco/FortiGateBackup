import assert from "node:assert/strict";
import test from "node:test";
import { parseFortiOsConfig, tokenizeFortiOsLine } from "./fortios-parser";
import { calculateSecurityScore, evaluateFortiOs, type LocalFinding } from "./rules";

const valid=`#config-version=FG100F-7.4.7-FW-build0000-000000:opmode=0:vdom=0:user=admin
config system interface
 edit "wan1"
  set role wan
  set allowaccess ping https ssh http telnet
 next
end
config firewall policy
 edit 41
  set srcaddr all
  set dstaddr all
  set service ALL
  set action accept
 next
end
`;
test("parseert FortiOS en ondersteunt quotes",()=>{const parsed=parseFortiOsConfig(valid);assert.equal(parsed.version,"7.4.7");assert.equal(parsed.nodes.length,2);assert.deepEqual(tokenizeFortiOsLine('set comments "regel met \\"quote\\""'),["set","comments",'regel met "quote"']);});
test("ondersteunt begrensde FortiOS multiline quoted waarden",()=>{const config=valid.replace("  set role wan",'  set role wan\n  set description "eerste regel\ntweede regel"');const parsed=parseFortiOsConfig(config);assert.deepEqual(parsed.nodes[0]?.values.description,["eerste regel\ntweede regel"]);assert.throws(()=>parseFortiOsConfig(config.replace('tweede regel"',"tweede regel")),/FORTIOS_UNTERMINATED_QUOTE/);});
test("weigert niet-FortiOS en incomplete structuur",()=>{assert.throws(()=>parseFortiOsConfig("hostname router"),/NOT_FORTIOS/);assert.throws(()=>parseFortiOsConfig(valid.replace(/end\nconfig firewall policy[\s\S]*/,"")),/INCOMPLETE/);});
test("regels en score zijn deterministisch",()=>{const first=evaluateFortiOs(parseFortiOsConfig(valid));const second=evaluateFortiOs(parseFortiOsConfig(valid));assert.deepEqual(first,second);assert.ok(first.score<100);assert.ok(first.findings.some((finding)=>finding.ruleId==="FG-POL-001"));assert.ok(first.findings.some((finding)=>finding.ruleId==="FG-MGT-001"));});
test("herhaalde bevindingen verlagen de score begrensd",()=>{
  const finding:LocalFinding={ruleId:"FG-LOG-001",category:"Logging",severity:"MEDIUM",penalty:5,title:"Logging ontbreekt",explanation:"synthetisch",evidence:"OBJECT_1",remediation:"synthetisch"};
  assert.equal(calculateSecurityScore([]),100);
  assert.equal(calculateSecurityScore([finding]),95);
  assert.equal(calculateSecurityScore(Array.from({length:100},()=>({...finding}))),90);
});
test("verschillende risicotypen blijven volledig meetellen",()=>{
  const finding=(ruleId:string,penalty:number):LocalFinding=>({ruleId,category:"Test",severity:"HIGH",penalty,title:"Test",explanation:"synthetisch",evidence:"OBJECT_1",remediation:"synthetisch"});
  assert.equal(calculateSecurityScore([finding("RULE-A",18),finding("RULE-B",10),finding("RULE-C",8)]),64);
});
