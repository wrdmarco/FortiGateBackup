import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseFortiOsConfig } from "./fortios-parser";
import { evaluateFortiOs, type RuntimeSecurityRule } from "./rules";
import { createSafeFoundryPayload } from "./safe-foundry";

test("declaratieve rules beoordelen uitsluitend geparseerde allowlistvelden",()=>{
  const parsed=parseFortiOsConfig(`#config-version=FG100E-7.4.1-FW-build1-240101:opmode=0:vdom=0:user=admin\nconfig system interface\nedit "wan1"\nset allowaccess ping snmp\nnext\nend\n`);
  const rules:RuntimeSecurityRule[]=[{ruleId:"FG-CUSTOM-001",category:"Beheer",severity:"HIGH",weight:10,title:"SNMP-beheer actief",explanation:"SNMP staat aan.",remediation:"Beperk SNMP.",positiveTitle:"SNMP-beheer is uitgeschakeld",evaluator:"DECLARATIVE",configPath:"system interface",conditions:[{field:"allowaccess",operator:"CONTAINS",value:"snmp"}]}];
  const result=evaluateFortiOs(parsed,rules);
  assert.equal(result.score,0);
  assert.equal(result.findings[0]?.ruleId,"FG-CUSTOM-001");
  assert.match(result.findings[0]?.evidence??"",/Interface: wan1/);
});

test("bevindingen tonen echte FortiGate-objectnamen lokaal maar Foundry ontvangt alleen tokens",()=>{
  const parsed=parseFortiOsConfig(`#config-version=FG100E-7.4.1-FW-build1-240101:opmode=0:vdom=0:user=admin\nconfig firewall policy\nedit 41\nset action accept\nset srcaddr all\nset dstaddr all\nset service ALL\nnext\nend\n`);
  const result=evaluateFortiOs(parsed);
  assert.match(result.findings[0]?.evidence??"",/Policy-ID: 41/);
  const payload=createSafeFoundryPayload({version:parsed.version,score:result.score,findings:result.findings,counts:{policies:1,interfaces:0,vdoms:1}});
  assert.doesNotMatch(JSON.stringify(payload),/Policy-ID|firewall policy|\b41\b/);
  assert.match(JSON.stringify(payload),/OBJECT_1/);
});

test("PostgreSQL dwingt één actieve en immutable gepubliceerde ruleset af",async()=>{
  const sql=await readFile("prisma/migrations/20260723190000_security_rulesets/migration.sql","utf8");
  assert.match(sql,/SecurityRuleset_one_active/);
  assert.match(sql,/published rulesets are immutable/);
  assert.match(sql,/rules in published rulesets are immutable/);
  assert.match(sql,/SecurityRule_declarative_fields/);
});

test("rulesetactions vereisen Global-context en aparte platformpermission",async()=>{
  const actions=await readFile("app/settings/rulesets/actions.ts","utf8");
  assert.match(actions,/platform\.security\.rulesets\.manage/);
  assert.match(actions,/isGlobalTenantId\(user\.tenantId\)/);
  assert.match(actions,/isGlobalTenantId\(tenantId\)/);
  assert.doesNotMatch(actions,/eval\(|new Function|child_process/);
});
