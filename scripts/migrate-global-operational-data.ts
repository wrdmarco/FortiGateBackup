import { prisma } from "@/lib/db";
import { mainTenantId } from "@/lib/tenant-main";

function argValue(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const globalTenantId = await mainTenantId();
  const targetTenantId = argValue("targetTenantId");
  if (!globalTenantId) throw new Error("Global tenant is niet gevonden.");
  if (!targetTenantId) {
    throw new Error("Gebruik: pnpm tsx scripts/migrate-global-operational-data.ts --targetTenantId=<tenant-id>");
  }
  if (targetTenantId === globalTenantId) {
    throw new Error("Doeltenant mag niet Global zijn.");
  }

  const targetTenant = await prisma.tenant.findFirst({
    where: { id: targetTenantId, active: true },
    select: { id: true, name: true }
  });
  if (!targetTenant) throw new Error("Doeltenant is niet gevonden of niet actief.");

  const customers = await prisma.customer.findMany({
    where: { tenantId: globalTenantId },
    select: { id: true }
  });
  if (!customers.length) {
    console.log("Geen operationele data onder Global gevonden.");
    return;
  }

  await prisma.customer.updateMany({
    where: { tenantId: globalTenantId },
    data: { tenantId: targetTenant.id }
  });
  console.log(`${customers.length} klant(en) van Global naar ${targetTenant.name} verplaatst.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
