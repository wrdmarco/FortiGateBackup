import { spawn, execFile } from "node:child_process";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const UPDATE_LOG = path.join("data", "logs", "update.log");
const UPDATE_LOCK = path.join("data", "logs", "update.lock");
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

export async function startAppUpdate() {
  const appDir = process.cwd();
  const logPath = path.join(appDir, UPDATE_LOG);
  const lockPath = path.join(appDir, UPDATE_LOCK);
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

  const command = [
    `cd ${shellQuote(appDir)}`,
    `echo "--- update started $(date -Is) ---" >> ${shellQuote(logPath)}`,
    `bash ./update.sh >> ${shellQuote(logPath)} 2>&1`,
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
    if (Date.now() - info.mtimeMs > LOCK_TTL_MS) await rm(lockPath, { force: true });
  } catch {
    // No lock present.
  }
}

async function readLastUpdateLog() {
  try {
    const log = await readFile(path.join(process.cwd(), UPDATE_LOG), "utf8");
    return log.split(/\r?\n/).filter(Boolean).slice(-8).join("\n") || null;
  } catch {
    return null;
  }
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}