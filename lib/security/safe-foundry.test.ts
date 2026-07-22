import assert from "node:assert/strict";
import test from "node:test";
import { createSafeFoundryPayload, residualSecretScan } from "./safe-foundry";
import { enrichWithFoundry } from "./foundry";

test("residual scan blokkeert synthetische secrets",()=>{for(const value of ["password super-secret","set psksecret synthetic","-----BEGIN PRIVATE KEY-----","ENC Abcdefghijklmnopqrstuvwxyz123456","A".repeat(120)])assert.throws(()=>residualSecretScan({value}),/SENSITIVE_DATA_DETECTED/);});
test("Foundry transport ontvangt uitsluitend gevalideerde allowlistdata",async()=>{const payload=createSafeFoundryPayload({version:"7.4.7",score:80,findings:[],counts:{policies:1,interfaces:2,vdoms:1}});let sent="";const transport:typeof fetch=async(_url,init)=>{sent=String(init?.body);return new Response(JSON.stringify({output:[{content:[{type:"output_text",text:JSON.stringify({managementSummary:"Veilige synthetische samenvatting.",enhancements:[]})}]}]}),{status:200,headers:{"x-request-id":"synthetic-request"}});};const result=await enrichWithFoundry({endpoint:"https://synthetic.openai.azure.com",deployment:"deployment-1",apiKey:"synthetic-key"},payload,transport);assert.equal(result.requestId,"synthetic-request");assert.ok(!sent.includes("synthetic-key"));assert.ok(!sent.includes("config system"));});
