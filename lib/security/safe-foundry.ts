import { createHash } from "node:crypto";
import { z } from "zod";
import type { LocalFinding } from "./rules";

const token = z.string().regex(/^(POLICY|INTERFACE|VDOM|ADDRESS|ADDRESS_GROUP|SERVICE|SERVICE_GROUP|OBJECT)_\d+$/).max(64);
export const safeFoundryPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  fortiOsVersion: z.string().regex(/^\d+(?:\.\d+){1,3}$/).max(24),
  score: z.number().int().min(0).max(100),
  findings: z.array(z.object({
    ruleId: z.string().regex(/^FG-[A-Z0-9]+-\d{3}$/),
    severity: z.enum(["CRITICAL","HIGH","MEDIUM","LOW"]),
    category: z.enum(["Firewallbeleid","Logging","Beheer","Security profiles","VPN","Objecten","Overig"]),
    objectToken: token,
    penalty: z.number().int().min(0).max(100),
    flags: z.record(z.string().regex(/^[a-z][a-zA-Z]+$/), z.boolean()).default({})
  })).max(500),
  counts: z.object({ policies: z.number().int().nonnegative().max(100000), interfaces: z.number().int().nonnegative().max(100000), vdoms: z.number().int().nonnegative().max(10000) })
}).strict();
export type SafeFoundryPayload = z.infer<typeof safeFoundryPayloadSchema> & { readonly __safeFoundryPayload: unique symbol };

export function createSafeFoundryPayload(input:{version:string;score:number;findings:LocalFinding[];counts:{policies:number;interfaces:number;vdoms:number}}):SafeFoundryPayload {
  const allowedCategories=new Set(["Firewallbeleid","Logging","Beheer","Security profiles","VPN","Objecten"]);
  const candidate={schemaVersion:1 as const,fortiOsVersion:input.version,score:input.score,findings:input.findings.map((finding,index)=>({ruleId:finding.ruleId,severity:finding.severity,category:(allowedCategories.has(finding.category)?finding.category:"Overig") as "Firewallbeleid",objectToken:`OBJECT_${index+1}`,penalty:finding.penalty,flags:{requiresReview:true}})),counts:input.counts};
  residualSecretScan(candidate);
  return safeFoundryPayloadSchema.parse(candidate) as SafeFoundryPayload;
}

export function residualSecretScan(value:unknown){
  const serialized=JSON.stringify(value);
  const forbidden=[/-----BEGIN/i,/certificate/i,/\b(?:password|passwd|psk|secret|token|authorization|credential|community)\b/i,/\bENC\s+[A-Za-z0-9+/=]{8,}/i,/\b[A-Za-z0-9+/]{96,}={0,2}\b/,/\bconfig\s+(?:system|firewall|vpn)\b/i,/\bset\s+\S+/i];
  if(serialized.length>256_000 || forbidden.some((pattern)=>pattern.test(serialized)))throw new Error("SENSITIVE_DATA_DETECTED");
}

export function safePayloadDigest(payload:SafeFoundryPayload){return createHash("sha256").update(JSON.stringify(payload)).digest("hex");}
