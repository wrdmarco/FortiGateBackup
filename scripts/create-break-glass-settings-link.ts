import crypto from "node:crypto";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { mainTenantId } from "@/lib/tenant-main";

const identifier = "break-glass:global-settings";
const ttlMinutes = 15;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const globalTenantId = await mainTenantId();
  if (!globalTenantId) throw new Error("Global tenant is niet gevonden.");

  const user = await prisma.user.findFirst({
    where: {
      role: UserRole.SUPER_ADMIN,
      active: true,
      tenantId: globalTenantId,
      ...(args.email ? { email: args.email.toLowerCase() } : {})
    },
    orderBy: { createdAt: "asc" }
  });
  if (!user) {
    throw new Error(args.email ? `Geen actieve Global super admin gevonden voor ${args.email}.` : "Geen actieve Global super admin gevonden.");
  }

  const rawToken = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + ttlMinutes * 60 * 1000);
  await prisma.verificationToken.deleteMany({
    where: {
      OR: [
        { identifier, expires: { lte: new Date() } },
        { identifier, token: hashToken(rawToken) }
      ]
    }
  });
  await prisma.verificationToken.create({
    data: {
      identifier,
      token: hashToken(rawToken),
      expires
    }
  });

  const baseUrl = normalizeBaseUrl(args.baseUrl ?? (await getSetting("portal.siteUrl", null)) ?? process.env.SERVER_URL ?? "http://localhost:3000");
  const url = `${baseUrl}/api/break-glass/settings/${rawToken}`;
  console.log("Eenmalige Global instellingen-link aangemaakt.");
  console.log(`Gebruiker: ${user.name ?? user.email} <${user.email}>`);
  console.log(`Geldig tot: ${expires.toISOString()}`);
  console.log("");
  console.log(url);
  console.log("");
  console.log("Open deze link vanaf een vertrouwd apparaat. Na openen is de link direct ongeldig.");
}

function parseArgs(args: string[]) {
  const parsed: { email?: string; baseUrl?: string } = {};
  for (const arg of args) {
    if (arg.startsWith("--email=")) parsed.email = arg.slice("--email=".length).trim();
    if (arg.startsWith("--base-url=")) parsed.baseUrl = arg.slice("--base-url=".length).trim();
  }
  return parsed;
}

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "http://localhost:3000";
  return trimmed.includes("://") ? trimmed : `https://${trimmed}`;
}

function hashToken(value: string) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
