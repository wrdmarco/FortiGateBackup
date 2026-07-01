import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

export async function getSetting(key: string, tenantId?: string | null) {
  const setting = await prisma.systemSetting.findFirst({
    where: { tenantId: tenantId ?? null, key },
    orderBy: { updatedAt: "desc" }
  });
  if (!setting) return null;
  return setting.encrypted ? decryptSecret(setting.value) : setting.value;
}

export async function setSetting(
  key: string,
  value: string,
  options: { tenantId?: string | null; encrypted?: boolean } = {}
) {
  const encrypted = options.encrypted ?? false;
  const existing = await prisma.systemSetting.findMany({
    where: { tenantId: options.tenantId ?? null, key },
    orderBy: { updatedAt: "desc" },
    select: { id: true }
  });
  if (existing[0]) {
    const setting = await prisma.systemSetting.update({
      where: { id: existing[0].id },
      data: {
        value: encrypted ? encryptSecret(value) : value,
        encrypted
      }
    });
    const duplicateIds = existing.slice(1).map((setting) => setting.id);
    if (duplicateIds.length) await prisma.systemSetting.deleteMany({ where: { id: { in: duplicateIds } } });
    return setting;
  }
  return prisma.systemSetting.create({
    data: {
      tenantId: options.tenantId ?? null,
      key,
      value: encrypted ? encryptSecret(value) : value,
      encrypted
    }
  });
}

export async function deleteSetting(key: string, tenantId?: string | null) {
  return prisma.systemSetting.deleteMany({
    where: { tenantId: tenantId ?? null, key }
  });
}
