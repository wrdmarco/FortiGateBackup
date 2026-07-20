import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { TenantKind, UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashOneTimeToken, setupTokenIsValid } from "@/lib/setup-token";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const tsxCli = path.join(path.dirname(require.resolve("tsx/package.json")), "dist", "cli.mjs");

test("setup-token gebruikt uitsluitend een SHA-256-hash en respecteert gebruik en verval", async () => {
  const rawToken = `setup-${process.pid}-${Date.now()}-${"x".repeat(40)}`;
  const tokenHash = hashOneTimeToken(rawToken);
  assert.match(tokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(tokenHash, rawToken);
  assert.notEqual(hashOneTimeToken(`${rawToken}-other`), tokenHash);

  try {
    await prisma.setupToken.deleteMany();
    const active = await prisma.setupToken.create({
      data: { tokenHash, expires: new Date(Date.now() + 60_000) }
    });
    assert.equal(await setupTokenIsValid(rawToken), true);
    assert.equal(await setupTokenIsValid(tokenHash), false);
    assert.equal((await prisma.setupToken.findUniqueOrThrow({ where: { id: active.id } })).tokenHash, tokenHash);

    await prisma.setupToken.update({ where: { id: active.id }, data: { usedAt: new Date() } });
    assert.equal(await setupTokenIsValid(rawToken), false);
    await prisma.setupToken.update({
      where: { id: active.id },
      data: { usedAt: null, expires: new Date(Date.now() - 1_000) }
    });
    assert.equal(await setupTokenIsValid(rawToken), false);
  } finally {
    await prisma.setupToken.deleteMany();
  }
});

test("break-glass CLI koppelt de gebruiker en bewaart nooit het ruwe token", async () => {
  const suffix = `${process.pid}_${Date.now()}`;
  const tenantId = `token_global_${suffix}`;
  const userId = `token_super_${suffix}`;
  const email = `break-glass-${suffix}@example.test`;
  const previousGlobalIds = (
    await prisma.tenant.findMany({ where: { kind: TenantKind.GLOBAL }, select: { id: true } })
  ).map(({ id }) => id);

  try {
    await prisma.tenant.updateMany({ where: { kind: TenantKind.GLOBAL }, data: { kind: TenantKind.CUSTOMER } });
    await prisma.tenant.create({
      data: { id: tenantId, name: "Global token test", slug: `global-token-${suffix}`, kind: TenantKind.GLOBAL }
    });
    await prisma.user.create({
      data: { id: userId, tenantId, email, name: "Break Glass Admin", role: UserRole.SUPER_ADMIN, active: true }
    });

    const output = await runCli([
      "scripts/create-break-glass-settings-link.ts",
      `--email=${email}`,
      "--base-url=https://portal.example.test"
    ]);
    const tokenMatch = output.match(/#token=([^\s]+)/);
    assert.ok(tokenMatch, output);
    const rawToken = decodeURIComponent(tokenMatch[1]);
    const stored = await prisma.verificationToken.findFirstOrThrow({
      where: { identifier: `break-glass:global-settings:${userId}` }
    });
    assert.equal(stored.token, hashOneTimeToken(rawToken));
    assert.notEqual(stored.token, rawToken);
    assert.match(stored.token, /^[a-f0-9]{64}$/);
    assert.ok(stored.expires > new Date());
  } finally {
    await prisma.verificationToken.deleteMany({ where: { identifier: { startsWith: "break-glass:global-settings:" } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    if (previousGlobalIds.length) {
      await prisma.tenant.updateMany({ where: { id: { in: previousGlobalIds } }, data: { kind: TenantKind.GLOBAL } });
    }
    await prisma.$disconnect();
  }
});

async function runCli(args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, ...args], {
      cwd: projectRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || stdout || `CLI stopte met exitcode ${code}.`));
    });
  });
}
