import { spawn, execFile } from "node:child_process";
import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const UPDATE_LOG = path.join("data", "logs", "update.log");
const UPDATE_LOCK = path.join("data", "logs", "update.lock");
const UPDATE_STATUS = path.join("data", "logs", "update-status.json");
const LOCK_TTL_MS = 1000 * 60 * 30;

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
  startedAt: string | null;
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
  const [running, status, lastLog] = await Promise.all([
    isUpdateRunning(),
    readUpdateStatus(),
    readLastUpdateLog(120)
  ]);
  if (!running) {
    await rm(lockPath, { force: true }).catch(() => undefined);
  }
  return {
    running,
    startedAt: status?.startedAt ?? null,
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
  await mkdir(path.dirname(logPath), { recursive: true });
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
  await writeFile(
    statusPath,
    JSON.stringify({ startedAt, startedByUserId: userId, returnTo: safeReturnTo(returnTo, "/") }, null, 2)
  );

  const command = [
    `cd ${shellQuote(appDir)}`,
    `echo "--- update started $(date -Is) ---" > ${shellQuote(logPath)}`,
    `FORTIGATE_UPDATE_LOCK_PATH=${shellQuote(lockPath)} bash ./update.sh >> ${shellQuote(logPath)} 2>&1`,
    `status=$?`,
    `echo "--- update finished $(date -Is) exit=$status ---" >> ${shellQuote(logPath)}`,
    `rm -f ${shellQuote(lockPath)}`,
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
    if ((await lockHasFinishedLog(info.mtimeMs)) || Date.now() - info.mtimeMs > LOCK_TTL_MS) {
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
    return JSON.parse(raw) as { startedAt?: string; startedByUserId?: string; returnTo?: string };
  } catch {
    return null;
  }
}

function safeReturnTo(value: unknown, fallback: string) {
  const raw = typeof value === "string" ? value : "";
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : fallback;
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
