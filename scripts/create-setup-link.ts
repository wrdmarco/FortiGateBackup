import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { hashOneTimeToken, setupTokenTtlMinutes } from "@/lib/setup-token";

async function main() {
  if ((await prisma.tenant.count()) > 0) {
    console.log("Setup is al uitgevoerd; er is geen nieuwe setup-link nodig.");
    return;
  }

  const rawToken = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + setupTokenTtlMinutes * 60 * 1000);
  await prisma.$transaction(async (tx) => {
    await tx.setupToken.deleteMany();
    await tx.setupToken.create({
      data: { tokenHash: hashOneTimeToken(rawToken), expires }
    });
  });

  const relativeUrl = `/setup#token=${encodeURIComponent(rawToken)}`;
  const baseUrl = parseBaseUrl(process.argv.slice(2));
  console.log("Eenmalige setup-link aangemaakt.");
  console.log(`Geldig tot: ${expires.toISOString()}`);
  console.log("");
  console.log(baseUrl ? `${baseUrl}${relativeUrl}` : relativeUrl);
  console.log("");
  console.log("Open deze link vanaf een vertrouwd apparaat. De link wordt na gebruik direct ongeldig.");
}

function parseBaseUrl(args: string[]) {
  const value = args.find((arg) => arg.startsWith("--base-url="))?.slice("--base-url=".length).trim();
  if (!value) return "";
  const normalized = value.includes("://") ? value : `https://${value}`;
  const url = new URL(normalized);
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("Base URL moet http of https gebruiken.");
  return url.toString().replace(/\/+$/, "");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
