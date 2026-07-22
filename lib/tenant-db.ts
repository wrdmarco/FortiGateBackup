import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export async function tenantTransaction<T>(tenantId:string,fn:(tx:Prisma.TransactionClient)=>Promise<T>,options?:{isolationLevel?:Prisma.TransactionIsolationLevel}){
  return prisma.$transaction(async(tx)=>{await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;return fn(tx);},{isolationLevel:options?.isolationLevel??"ReadCommitted"});
}
