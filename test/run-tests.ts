import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "fortigate-backup-tests-"));
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl || !/^postgres(?:ql)?:/.test(databaseUrl)) throw new Error("Tests vereisen een echte tijdelijke PostgreSQL-database.");
const parsedDatabaseUrl = new URL(databaseUrl);
if (!["localhost", "127.0.0.1"].includes(parsedDatabaseUrl.hostname) || !/(?:test|ci)/i.test(parsedDatabaseUrl.pathname)) {
  throw new Error("Weigert tests tegen een niet-lokale of niet als test/ci herkenbare database.");
}
const require = createRequire(import.meta.url);
const prismaCli = path.join(path.dirname(require.resolve("prisma/package.json")), "build", "index.js");
const tsxCli = path.join(path.dirname(require.resolve("tsx/package.json")), "dist", "cli.mjs");
const testEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  NEXTAUTH_SECRET: "regression-nextauth-secret-000000000000000000000000",
  ENCRYPTION_KEY: "regression-encryption-key-00000000000000000000000",
  NODE_ENV: "test",
  TENANT_ARCHIVE_INTEGRATION: "1",
  NEXT_TELEMETRY_DISABLED: "1",
  CHECKPOINT_DISABLE: "1"
};

try {
  await run(process.execPath, [prismaCli, "generate"], testEnvironment);
  await run(process.execPath, [prismaCli, "generate", "--schema", "prisma/legacy-sqlite/schema.prisma"], {
    ...testEnvironment,
    DATABASE_URL: `file:${path.join(temporaryRoot, "legacy-client.db").replace(/\\/g, "/")}`
  });
  await run(process.execPath, [prismaCli, "migrate", "reset", "--force", "--skip-seed"], testEnvironment);

  const testFiles = (
    await Promise.all(["app", "lib", "test"].map((directory) => collectTests(path.join(projectRoot, directory))))
  )
    .flat()
    .sort((left, right) => left.localeCompare(right));
  if (!testFiles.length) throw new Error("Geen regressietests gevonden.");

  await run(process.execPath, [tsxCli, "--test", "--test-concurrency=1", ...testFiles], testEnvironment);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function collectTests(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectTests(fullPath);
      return entry.isFile() && entry.name.endsWith(".test.ts") ? [fullPath] : [];
    })
  );
  return files.flat();
}

async function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env,
      stdio: "inherit",
      windowsHide: true
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} stopte met ${signal ? `signaal ${signal}` : `exitcode ${code}`}.`));
    });
  });
}
