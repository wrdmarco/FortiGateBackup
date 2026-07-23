import assert from "node:assert/strict";
import test from "node:test";
import { parseFortiOsConfig, tokenizeFortiOsLine } from "./fortios-parser";
import { calculateSecurityScore, evaluateFortiOs, type SecurityControlResult } from "./rules";

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
test("geslaagde en mislukte controles bepalen samen het percentage",()=>{
  const controls:SecurityControlResult[]=[
    {ruleId:"SAFE-A",weight:10,passed:true},
    {ruleId:"SAFE-B",weight:10,passed:true},
    {ruleId:"RISK-C",weight:10,passed:false}
  ];
  assert.equal(calculateSecurityScore([]).score,100);
  assert.equal(calculateSecurityScore(controls).score,67);
  assert.deepEqual(calculateSecurityScore(controls).components.find((item)=>item.ruleId==="SAFE-A"),{ruleId:"SAFE-A",passed:1,failed:0,earned:10,possible:10});
});
test("goede configuratieobjecten leveren aantoonbaar punten op",()=>{
  const result=calculateSecurityScore([
    {ruleId:"FG-LOG-001",weight:5,passed:false},
    ...Array.from({length:9},():SecurityControlResult=>({ruleId:"FG-LOG-001",weight:5,passed:true}))
  ]);
  assert.equal(result.score,90);
  assert.equal(result.passed,9);
  assert.equal(result.total,10);
});
