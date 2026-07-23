import { TenantKind } from "@prisma/client";
import { auditLog } from "@/lib/audit";
import { decryptSecretWithAad, encryptSecretWithAad } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { tenantTransaction } from "@/lib/tenant-db";
import { validateDeployment, validateFoundryEndpoint } from "./foundry";

const aad=(tenantId:string)=>`foundry-api-key:${tenantId}:v1`;
export async function getUsableFoundryConfig(tenantId:string){const row=await tenantTransaction(tenantId,(tx)=>tx.tenantFoundryConfig.findUnique({where:{tenantId},include:{tenant:{select:{kind:true,active:true}}}}));if(!row?.enabled||!row.tenant.active||row.tenant.kind!==TenantKind.CUSTOMER)return null;return{endpoint:row.endpoint,deployment:row.deployment,apiKey:decryptSecretWithAad(row.apiKeyEncrypted,aad(tenantId))};}
export async function saveFoundryConfig(input:{tenantId:string;endpoint:string;deployment:string;apiKey?:string;enabled:boolean;userId:string}){
  const tenant=await prisma.tenant.findUniqueOrThrow({where:{id:input.tenantId},select:{kind:true}});
  if(tenant.kind!==TenantKind.CUSTOMER)throw new Error("GLOBAL_TENANT_FOUNDRY_FORBIDDEN");
  const endpoint=validateFoundryEndpoint(input.endpoint).toString().replace(/\/$/,"");
  const deployment=validateDeployment(input.deployment);
  const existing=await tenantTransaction(input.tenantId,async(tx)=>{
    const current=await tx.tenantFoundryConfig.findUnique({where:{tenantId:input.tenantId}});
    if(current){
      await tx.tenantFoundryConfig.update({
        where:{tenantId:input.tenantId},
        data:{endpoint,deployment,enabled:input.enabled,...(input.apiKey?{apiKeyEncrypted:encryptSecretWithAad(input.apiKey,aad(input.tenantId))}:{})}
      });
      return true;
    }
    if(!input.apiKey)throw new Error("FOUNDRY_API_KEY_REQUIRED");
    await tx.tenantFoundryConfig.create({
      data:{tenantId:input.tenantId,endpoint,deployment,enabled:input.enabled,apiKeyEncrypted:encryptSecretWithAad(input.apiKey,aad(input.tenantId))}
    });
    return false;
  },{isolationLevel:"Serializable"});
  await auditLog({action:existing?(input.apiKey?"foundry.key.replaced":"foundry.config.updated"):"foundry.config.added",tenantId:input.tenantId,userId:input.userId,entity:"TenantFoundryConfig",entityId:input.tenantId,metadata:{endpointHost:new URL(endpoint).hostname,deployment,enabled:input.enabled}});
}

export async function maskedFoundryConfig(tenantId:string){return tenantTransaction(tenantId,async(tx)=>{const row=await tx.tenantFoundryConfig.findUnique({where:{tenantId},select:{enabled:true,endpoint:true,deployment:true,lastValidatedAt:true,lastValidationStatus:true,apiKeyEncrypted:true}});return row?{...row,apiKeyEncrypted:undefined,hasApiKey:Boolean(row.apiKeyEncrypted)}:null;});}
