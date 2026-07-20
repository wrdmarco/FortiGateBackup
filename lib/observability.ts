import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

const OPERATIONAL_LOG_DIRECTORY = path.join(process.cwd(), "data", "logs");
const OPERATIONAL_LOG_PREFIX = "operational-";
const OPERATIONAL_LOG_RETENTION_DAYS = 30;
const RETENTION_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SENSITIVE_KEY = /password|token|secret|api[-_]?key|cookie|authorization|credential|connection|string|config/i;

type OperationalOutcome = "success" | "failure";
type OperationalLevel = "info" | "warning" | "error";
type OperationalValue = string | number | boolean | null;

export type OperationalEventInput = {
  event: "worker.started" | "worker.cycle" | "health.failed";
  service: "worker" | "web";
  operation: string;
  outcome: OperationalOutcome;
  level?: OperationalLevel;
  durationMs?: number;
  requestId?: string | null;
  trigger?: string;
  metrics?: Record<string, OperationalValue>;
  error?: unknown;
};

let drainQueue: Promise<void> = Promise.resolve();
let lastRetentionCheck = 0;

/**
 * Writes a best-effort, redacted wide event. Drain failures never take the app
 * or worker down and are deliberately not echoed to stdout/stderr.
 */
export function recordOperationalEvent(input: OperationalEventInput): Promise<void> {
  const event = buildOperationalEvent(input);
  const write = drainQueue.then(async () => {
    await mkdir(OPERATIONAL_LOG_DIRECTORY, { recursive: true });
    await runRetentionIfDue();
    const filePath = path.join(OPERATIONAL_LOG_DIRECTORY, `${OPERATIONAL_LOG_PREFIX}${utcDateStamp()}.ndjson`);
    await appendFile(filePath, `${JSON.stringify(event)}\n`, {
      encoding: "utf8",
      flag: "a",
      mode: 0o600
    });
  });

  drainQueue = write.catch(() => undefined);
  return drainQueue;
}

function buildOperationalEvent(input: OperationalEventInput) {
  const memory = process.memoryUsage();
  return redactOperationalValue({
    timestamp: new Date().toISOString(),
    schemaVersion: 1,
    eventId: randomUUID(),
    event: input.event,
    service: input.service,
    operation: input.operation,
    level: input.level ?? (input.outcome === "failure" ? "error" : "info"),
    outcome: input.outcome,
    durationMs: normalizeDuration(input.durationMs),
    requestId: normalizeIdentifier(input.requestId),
    trigger: normalizeLabel(input.trigger),
    metrics: input.metrics,
    error: input.error === undefined ? undefined : summarizeError(input.error),
    process: {
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed
    }
  });
}

async function runRetentionIfDue() {
  const now = Date.now();
  if (now - lastRetentionCheck < RETENTION_CHECK_INTERVAL_MS) return;
  lastRetentionCheck = now;

  const entries = await readdir(OPERATIONAL_LOG_DIRECTORY, { withFileTypes: true });
  const cutoff = now - OPERATIONAL_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && /^operational-\d{4}-\d{2}-\d{2}\.ndjson$/.test(entry.name))
      .map(async (entry) => {
        const filePath = path.join(OPERATIONAL_LOG_DIRECTORY, entry.name);
        const file = await stat(filePath);
        if (file.mtimeMs < cutoff) await unlink(filePath);
      })
  );
}

function summarizeError(error: unknown) {
  const type = error instanceof Error ? normalizeLabel(error.name) ?? "Error" : "UnknownError";
  const code = readSafeErrorCode(error);
  const source = error instanceof Error ? `${error.name}:${code ?? ""}:${error.message}` : String(error);
  return {
    type,
    code,
    fingerprint: createHash("sha256").update(source, "utf8").digest("hex").slice(0, 24)
  };
}

function readSafeErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = String(error.code);
  return /^[A-Z0-9_-]{1,32}$/i.test(code) ? code : undefined;
}

function normalizeDuration(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.round(value));
}

function normalizeIdentifier(value: string | null | undefined) {
  if (!value) return undefined;
  const normalized = value.trim();
  return /^[A-Za-z0-9._:-]{1,128}$/.test(normalized) ? normalized : undefined;
}

function normalizeLabel(value: string | undefined) {
  if (!value) return undefined;
  const normalized = value.trim();
  return /^[A-Za-z0-9._:-]{1,80}$/.test(normalized) ? normalized : undefined;
}

function redactOperationalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactOperationalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [
        key,
        SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactOperationalValue(entry)
      ])
  );
}

function utcDateStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}
