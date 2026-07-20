import { spawn, execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmod, copyFile, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { cookies } from "next/headers";

const execFileAsync = promisify(execFile);
const UPDATE_LOG = path.join("data", "logs", "update.log");
const UPDATE_LOCK = path.join("data", "logs", "update.lock");
const UPDATE_STATUS = path.join("data", "logs", "update-status.json");
const MAINTENANCE_SOURCE = path.join("scripts", "maintenance-server.mjs");
const MAINTENANCE_RUNTIME = path.join("data", "update-runtime", "maintenance-server.mjs");
const UPDATE_VIEWER_COOKIE = "fgbp_update_viewer";
const LOCK_TTL_MS = 1000 * 60 * 30;

export type UpdateOutcome = "idle" | "running" | "success" | "error";

type PersistedUpdateStatus = {
  schemaVersion?: number;
  operation?: "update" | "rollback";
  outcome?: UpdateOutcome;
  startedAt?: string;
  startedByUserId?: string | null;
  returnTo?: string;
  viewerTokenHash?: string | null;
  finishedAt?: string | null;
  exitCode?: number | null;
};

type AppUpdateStatus = {
  currentVersion: string;
  localCommit: string | null;
  remoteCommit: string | null;
  branch: string | null;
  updateAvailable: boolean;
  updateRunning: boolean;
  lastLog: string | null;
  error: string | null;
};

export type UpdateRuntimeStatus = {
  running: boolean;
  outcome: UpdateOutcome;
  operation: "update" | "rollback";
  startedAt: string | null;
  finishedAt: string | null;
  startedByUserId: string | null;
  returnTo: string;
  lastLog: string | null;
};

export async function getAppUpdateStatus(): Promise<AppUpdateStatus> {
  const [currentVersion, localCommit, branch, updateRunning, lastLog] = await Promise.all([
    getPackageVersion(),
    git(["rev-parse", "HEAD"]),
    git(["rev-parse", "--abbrev-ref", "HEAD"]),
    isUpdateRunning(),
    readLastUpdateLog()
  ]);
  const remoteCommit = branch ? await git(["ls-remote", "origin", `refs/heads/${branch}`]) : null;
  const remoteSha = remoteCommit?.split(/\s+/)[0] ?? null;
  const localSha = localCommit?.trim() ?? null;

  return {
    currentVersion,
    localCommit: localSha,
    remoteCommit: remoteSha,
    branch: branch?.trim() ?? null,
    updateAvailable: Boolean(localSha && remoteSha && localSha !== remoteSha),
    updateRunning,
    lastLog,
    error: localSha ? null : "Git repository kon niet worden gelezen."
  };
}

export async function getUpdateRuntimeStatus(): Promise<UpdateRuntimeStatus> {
  const appDir = process.cwd();
  const lockPath = path.join(appDir, UPDATE_LOCK);
  const [lockPresent, status, lastLog] = await Promise.all([
    isUpdateRunning(),
    readUpdateStatus(),
    readLastUpdateLog(120)
  ]);
  const declaredOutcome = normalizeOutcome(status?.outcome);
  const running = lockPresent && declaredOutcome !== "success" && declaredOutcome !== "error";
  const outcome: UpdateOutcome = running
    ? "running"
    : declaredOutcome === "success" || declaredOutcome === "error"
      ? declaredOutcome
      : declaredOutcome === "running"
        ? "error"
        : "idle";
  if (!running && lockPresent) {
    await rm(lockPath, { force: true }).catch(() => undefined);
  }
  return {
    running,
    outcome,
    operation: status?.operation === "rollback" ? "rollback" : "update",
    startedAt: status?.startedAt ?? null,
    finishedAt: status?.finishedAt ?? null,
    startedByUserId: status?.startedByUserId ?? null,
    returnTo: safeReturnTo(status?.returnTo, "/"),
    lastLog
  };
}

export async function startAppUpdate({ userId, returnTo }: { userId: string; returnTo?: string }) {
  const appDir = process.cwd();
  const logPath = path.join(appDir, UPDATE_LOG);
  const lockPath = path.join(appDir, UPDATE_LOCK);
  const statusPath = path.join(appDir, UPDATE_STATUS);
  const runtimePath = path.join(appDir, MAINTENANCE_RUNTIME);
  await prepareMaintenanceRuntime(appDir);
  await mkdir(path.dirname(logPath), { recursive: true, mode: 0o700 });
  await clearStaleLock(lockPath);

  let lockHandle;
  try {
    lockHandle = await open(lockPath, "wx");
    await lockHandle.writeFile(`${Date.now()}\n`);
  } catch {
    return { started: false, message: "Er draait al een update." };
  } finally {
    await lockHandle?.close();
  }
  const startedAt = new Date().toISOString();
  const viewerToken = randomBytes(32).toString("base64url");
  await writeJsonAtomic(statusPath, {
    schemaVersion: 1,
    operation: "update",
    outcome: "running",
    startedAt,
    startedByUserId: userId,
    returnTo: safeReturnTo(returnTo, "/"),
    viewerTokenHash: createHash("sha256").update(viewerToken).digest("hex"),
    finishedAt: null,
    exitCode: null
  } satisfies PersistedUpdateStatus);

  const cookieStore = await cookies();
  cookieStore.set(UPDATE_VIEWER_COOKIE, viewerToken, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 2
  });

  const command = [
    `cd ${shellQuote(appDir)}`,
    `echo "--- update started $(date -Is) ---" > ${shellQuote(logPath)}`,
    `status=0`,
    `FORTIGATE_UPDATE_LOCK_PATH=${shellQuote(lockPath)} bash ./update.sh >> ${shellQuote(logPath)} 2>&1 || status=$?`,
    `echo "--- update finished $(date -Is) exit=$status ---" >> ${shellQuote(logPath)}`,
    `node ${shellQuote(runtimePath)} finalize --app-dir ${shellQuote(appDir)} --exit-code "$status" || rm -f ${shellQuote(lockPath)}`,
    `exit $status`
  ].join("; ");

  const child = spawn("bash", ["-lc", command], {
    cwd: appDir,
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  return { started: true, message: "Update gestart. De applicatie herstart zichzelf wanneer de update klaar is." };
}

async function getPackageVersion() {
  try {
    const pkg = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

async function git(args: string[]) {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: process.cwd(), timeout: 12000, windowsHide: true });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function isUpdateRunning() {
  try {
    await clearStaleLock(path.join(process.cwd(), UPDATE_LOCK));
    await stat(path.join(process.cwd(), UPDATE_LOCK));
    return true;
  } catch {
    return false;
  }
}

async function clearStaleLock(lockPath: string) {
  try {
    const info = await stat(lockPath);
    const status = await readUpdateStatus();
    if (
      status?.outcome === "success" ||
      status?.outcome === "error" ||
      (await lockHasFinishedLog(info.mtimeMs)) ||
      Date.now() - info.mtimeMs > LOCK_TTL_MS
    ) {
      await rm(lockPath, { force: true });
    }
  } catch {
    // No lock present.
  }
}

async function lockHasFinishedLog(lockMtimeMs: number) {
  try {
    const logPath = path.join(process.cwd(), UPDATE_LOG);
    const [logInfo, log] = await Promise.all([stat(logPath), readFile(logPath, "utf8")]);
    return logInfo.mtimeMs >= lockMtimeMs && (/--- update finished .* exit=\d+ ---/.test(log) || /Update complete\./.test(log));
  } catch {
    return false;
  }
}

export async function readUpdateLog(maxLines = 300) {
  return readLastUpdateLog(maxLines);
}

async function readLastUpdateLog(maxLines = 8) {
  try {
    const log = await readFile(path.join(process.cwd(), UPDATE_LOG), "utf8");
    return log.split(/\r?\n/).filter(Boolean).slice(-maxLines).join("\n") || null;
  } catch {
    return null;
  }
}

async function readUpdateStatus() {
  try {
    const raw = await readFile(path.join(process.cwd(), UPDATE_STATUS), "utf8");
    return JSON.parse(raw) as PersistedUpdateStatus;
  } catch {
    return null;
  }
}

async function prepareMaintenanceRuntime(appDir: string) {
  const source = path.join(appDir, MAINTENANCE_SOURCE);
  const runtime = path.join(appDir, MAINTENANCE_RUNTIME);
  await mkdir(path.dirname(runtime), { recursive: true, mode: 0o700 });
  await copyFile(source, runtime);
  await chmod(runtime, 0o700);
}

async function writeJsonAtomic(target: string, value: PersistedUpdateStatus) {
  const temporary = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
}

function normalizeOutcome(value: unknown): UpdateOutcome {
  return value === "running" || value === "success" || value === "error" ? value : "idle";
}

function safeReturnTo(value: unknown, fallback: string) {
  const raw = typeof value === "string" ? value : "";
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : fallback;
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
