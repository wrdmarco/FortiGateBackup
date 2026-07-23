#!/usr/bin/env node

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { open, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const STATUS_FILE = path.join("data", "logs", "update-status.json");
const LOCK_FILE = path.join("data", "logs", "update.lock");
const LOG_FILE = path.join("data", "logs", "update.log");
const VIEWER_COOKIE = "fgbp_update_viewer";
const MAX_LOG_BYTES = 256 * 1024;
const MAX_LOG_LINES = 400;

export function hashViewerToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function safeReturnTo(value, fallback = "/") {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

export async function beginMaintenance({ appDir, operation = "update", returnTo = "/" }) {
  const previous = await readStatus(appDir);
  const preserve = previous?.outcome === "running";
  const next = {
    schemaVersion: 1,
    operation: operation === "rollback" ? "rollback" : "update",
    outcome: "running",
    startedAt: preserve && previous.startedAt ? previous.startedAt : new Date().toISOString(),
    startedByUserId: preserve ? previous.startedByUserId ?? null : null,
    returnTo: preserve ? safeReturnTo(previous.returnTo, returnTo) : safeReturnTo(returnTo),
    viewerTokenHash: preserve ? previous.viewerTokenHash ?? null : null,
    finishedAt: null,
    exitCode: null
  };
  await writeStatus(appDir, next);
  return next;
}

export async function finalizeMaintenance({ appDir, exitCode }) {
  const previous = await readStatus(appDir);
  const numericExitCode = Number.isInteger(exitCode) ? exitCode : 1;
  const next = {
    schemaVersion: 1,
    operation: previous?.operation === "rollback" ? "rollback" : "update",
    outcome: numericExitCode === 0 ? "success" : "error",
    startedAt: previous?.startedAt ?? new Date().toISOString(),
    startedByUserId: previous?.startedByUserId ?? null,
    returnTo: safeReturnTo(previous?.returnTo),
    viewerTokenHash: previous?.viewerTokenHash ?? null,
    finishedAt: new Date().toISOString(),
    exitCode: numericExitCode
  };
  await writeStatus(appDir, next);
  await rm(path.join(appDir, LOCK_FILE), { force: true });
  return next;
}

export async function buildSnapshot({ appDir, cookieHeader = "" }) {
  const [status, lockPresent] = await Promise.all([readStatus(appDir), fileExists(path.join(appDir, LOCK_FILE))]);
  const declaredOutcome = normalizeOutcome(status?.outcome);
  const running = lockPresent && declaredOutcome !== "success" && declaredOutcome !== "error";
  const outcome = running
    ? "running"
    : declaredOutcome === "success" || declaredOutcome === "error"
      ? declaredOutcome
      : declaredOutcome === "running"
        ? "error"
        : "idle";
  const viewer = isLogViewer(cookieHeader, status?.viewerTokenHash);

  return {
    source: "maintenance",
    running,
    done: !running,
    outcome,
    operation: status?.operation === "rollback" ? "rollback" : "update",
    startedAt: typeof status?.startedAt === "string" ? status.startedAt : null,
    finishedAt: typeof status?.finishedAt === "string" ? status.finishedAt : null,
    returnTo: viewer ? safeReturnTo(status?.returnTo) : "/",
    isStarter: viewer,
    log: viewer ? await readLogTail(appDir) : null
  };
}

export function createMaintenanceServer({ appDir }) {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const method = request.method ?? "GET";
      setSecurityHeaders(response);

      if (method !== "GET" && method !== "HEAD") {
        response.writeHead(503, {
          "Content-Type": "application/json; charset=utf-8",
          "Retry-After": "5"
        });
        response.end(JSON.stringify({ error: "maintenance" }));
        return;
      }

      if (url.pathname === "/api/health") {
        const snapshot = await buildSnapshot({ appDir, cookieHeader: request.headers.cookie });
        sendJson(response, method, {
          status: "maintenance",
          updateRunning: snapshot.running,
          outcome: snapshot.outcome,
          timestamp: new Date().toISOString()
        });
        return;
      }

      if (url.pathname === "/api/update/events") {
        if (url.searchParams.get("poll") === "1" || !acceptsEventStream(request)) {
          sendJson(response, method, await buildSnapshot({ appDir, cookieHeader: request.headers.cookie }));
          return;
        }
        if (method === "HEAD") {
          response.writeHead(200, eventHeaders());
          response.end();
          return;
        }
        await streamSnapshots(request, response, appDir);
        return;
      }

      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
        "Retry-After": "5"
      });
      response.end(method === "HEAD" ? undefined : maintenanceHtml());
    } catch {
      if (!response.headersSent) {
        setSecurityHeaders(response);
        response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      }
      response.end(JSON.stringify({ error: "maintenance_status_unavailable" }));
    }
  });

  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

async function streamSnapshots(request, response, appDir) {
  response.writeHead(200, eventHeaders());
  let closed = false;
  let timer = null;

  const close = () => {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    response.end();
  };
  request.once("close", close);

  const send = async () => {
    if (closed) return;
    const snapshot = await buildSnapshot({ appDir, cookieHeader: request.headers.cookie });
    response.write(`event: ${snapshot.running ? "snapshot" : "done"}\ndata: ${JSON.stringify(snapshot)}\n\n`);
    if (snapshot.running) timer = setTimeout(() => void send().catch(close), 1_000);
    else close();
  };
  await send();
}

function eventHeaders() {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  };
}

function sendJson(response, method, value) {
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, max-age=0"
  });
  response.end(method === "HEAD" ? undefined : JSON.stringify(value));
}

function setSecurityHeaders(response) {
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; connect-src 'self'; img-src 'self' data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  );
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
}

function acceptsEventStream(request) {
  return String(request.headers.accept ?? "").includes("text/event-stream");
}

function isLogViewer(cookieHeader, expectedHash) {
  if (typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
  const token = parseCookies(cookieHeader)[VIEWER_COOKIE];
  if (!token) return false;
  const actual = Buffer.from(hashViewerToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function parseCookies(cookieHeader) {
  const cookies = {};
  for (const part of String(cookieHeader ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      cookies[name] = rawValue;
    }
  }
  return cookies;
}

function normalizeOutcome(value) {
  return value === "running" || value === "success" || value === "error" ? value : "idle";
}

async function readStatus(appDir) {
  try {
    const value = JSON.parse(await readFile(path.join(appDir, STATUS_FILE), "utf8"));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

async function writeStatus(appDir, value) {
  const target = path.join(appDir, STATUS_FILE);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
}

async function readLogTail(appDir) {
  const target = path.join(appDir, LOG_FILE);
  let handle;
  try {
    const info = await stat(target);
    const length = Math.min(info.size, MAX_LOG_BYTES);
    const buffer = Buffer.alloc(length);
    handle = await open(target, "r");
    await handle.read(buffer, 0, length, Math.max(0, info.size - length));
    return buffer.toString("utf8").split(/\r?\n/).filter(Boolean).slice(-MAX_LOG_LINES).join("\n") || null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function fileExists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function probe(url, retries) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const result = await new Promise((resolve, reject) => {
        const request = http.get(url, { timeout: 2_000 }, (response) => {
          response.resume();
          response.once("end", () => resolve(response.statusCode ?? 0));
        });
        request.once("timeout", () => request.destroy(new Error("probe timeout")));
        request.once("error", reject);
      });
      if (result === 200) return;
      lastError = new Error(`probe returned HTTP ${result}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError ?? new Error("maintenance probe failed");
}

function maintenanceHtml() {
  return `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>FortiGate Backup Portal - onderhoud</title>
  <style>
    :root{color-scheme:light;--bg:#f4f6f8;--surface:#fff;--soft:#f8fafc;--text:#18212b;--muted:#5d6977;--line:#d7dde4;--accent:#c8202f;--accent-dark:#9e1722;--terminal:#101820;--terminal-text:#d9e2ec;--focus:#2563eb}
    @media(prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#0f1419;--surface:#171d23;--soft:#1d242c;--text:#f3f5f7;--muted:#aab4bf;--line:#303943;--accent:#ef4b58;--accent-dark:#ff6975;--terminal:#090d11;--terminal-text:#d9e2ec;--focus:#60a5fa}}
    *{box-sizing:border-box}html,body{min-height:100%;margin:0}body{background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:0}
    .topbar{height:76px;background:#11243e;border-bottom:1px solid rgba(255,255,255,.1);display:flex;align-items:center;padding:0 28px;color:#fff}.brand{display:flex;align-items:center;gap:13px;font-size:15px;font-weight:800;letter-spacing:.08em}.brand svg{width:38px;height:44px;flex:none}.brand-name .forti{color:#ef2935}.brand-name .backup{color:#f8fafc}.brand-context{margin-left:10px;padding-left:16px;border-left:1px solid rgba(255,255,255,.24);color:#aebbd0;font-size:12px;font-weight:650;letter-spacing:.04em}
    main{width:min(1080px,calc(100% - 32px));margin:0 auto;padding:clamp(32px,7vh,72px) 0 40px}.eyebrow{margin:0 0 12px;color:var(--accent);font-size:13px;font-weight:800;text-transform:uppercase}.title{max-width:760px;margin:0;font-size:clamp(30px,5vw,52px);line-height:1.08;font-weight:760}.intro{max-width:700px;margin:18px 0 0;color:var(--muted);font-size:16px;line-height:1.7}
    .status{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:24px;margin-top:36px;padding:26px;border:1px solid var(--line);border-radius:14px;background:var(--surface);box-shadow:0 18px 48px rgba(17,36,62,.08)}.progress{height:8px;margin:18px 0 14px;overflow:hidden;border-radius:999px;background:var(--line)}.progress span{display:block;width:38%;height:100%;border-radius:inherit;background:linear-gradient(90deg,#ef2935,#ff6670);animation:move 1.4s ease-in-out infinite}.meta{display:flex;flex-wrap:wrap;gap:10px 20px;color:var(--muted);font-size:13px}.summary{align-self:start;border-left:3px solid var(--accent);padding:2px 0 2px 18px}.summary strong{display:block;font-size:15px}.summary span{display:block;margin-top:8px;color:var(--muted);font-size:13px;line-height:1.55}.phase-label{display:flex;align-items:center;gap:9px;color:var(--text);font-size:13px;font-weight:800}.phase-label:before{content:"";width:9px;height:9px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 5px color-mix(in srgb,var(--accent) 14%,transparent)}.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:24px}.step{padding-top:10px;border-top:2px solid var(--line);color:var(--muted);font-size:11px;font-weight:750}.step.active{border-color:var(--accent);color:var(--text)}
    .log{display:none;margin-top:28px;border:1px solid var(--line);border-radius:6px;overflow:hidden;background:var(--terminal)}.log.visible{display:block}.log-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 16px;border-bottom:1px solid #27313b;color:#fff;font-size:13px;font-weight:700}.live{color:#8dd9a3;font-size:12px}.log pre{min-height:220px;max-height:44vh;margin:0;padding:16px;overflow:auto;white-space:pre-wrap;color:var(--terminal-text);font:12px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace}
    .error .progress span{width:100%;animation:none;background:var(--accent-dark)}.error .summary{border-left-color:var(--accent-dark)}
    @keyframes move{0%{transform:translateX(-110%)}50%{transform:translateX(110%)}100%{transform:translateX(285%)}}
    @media(max-width:720px){.topbar{height:66px;padding:0 16px}.brand-context{display:none}main{width:min(100% - 32px,1080px);padding-top:36px}.status{grid-template-columns:1fr;padding:20px}.summary{border-left:0;border-top:3px solid var(--accent);padding:16px 0 0}.steps{grid-template-columns:repeat(2,1fr)}.log pre{max-height:38vh}}
    @media(prefers-reduced-motion:reduce){.progress span{animation:none;width:70%}}
  </style>
</head>
<body>
  <header class="topbar"><div class="brand"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 4 56 15v16c0 14-8.7 23.4-24 29.2C16.7 54.4 8 45 8 31V15L32 4Z" fill="none" stroke="#f8fafc" stroke-width="4" stroke-linejoin="round"/><path d="M35 17c6 1 10 3 14 7v22c-4 4-8 7-14 10V17Z" fill="#f8fafc"/><g fill="#ef2935"><rect x="15" y="20" width="7" height="7" rx="1.4"/><rect x="24" y="20" width="7" height="7" rx="1.4"/><rect x="15" y="29" width="7" height="7" rx="1.4"/><rect x="15" y="38" width="7" height="7" rx="1.4"/><rect x="24" y="38" width="7" height="7" rx="1.4"/></g></svg><span class="brand-name"><span class="forti">FORTI</span><span class="backup"> BACKUP</span></span><span class="brand-context">Veilige updateomgeving</span></div></header>
  <main id="main">
    <p class="eyebrow" id="eyebrow">Gepland onderhoud</p>
    <h1 class="title" id="title">De portal wordt veilig bijgewerkt</h1>
    <p class="intro" id="message">De interface is tijdelijk gepauzeerd. Backups en instellingen blijven beschermd terwijl de nieuwe versie wordt geinstalleerd.</p>
    <section class="status" aria-live="polite">
      <div>
        <div class="phase-label" id="phase-label">Update voorbereiden</div>
        <div class="progress" role="progressbar" aria-label="Updatevoortgang"><span></span></div>
        <div class="meta"><span id="connection">Status wordt gecontroleerd</span><span id="started"></span></div>
        <div class="steps" aria-label="Updatefasen"><span class="step active">Voorbereiden</span><span class="step">Database</span><span class="step">Applicatie</span><span class="step">Controle</span></div>
      </div>
      <div class="summary"><strong id="summary-title">Update in uitvoering</strong><span id="summary-text">Deze pagina controleert automatisch wanneer de portal weer beschikbaar is.</span></div>
    </section>
    <section class="log" id="log-panel" aria-label="Live update log">
      <div class="log-head"><span>Live update log</span><span class="live" id="live-state">Live</span></div>
      <pre id="log">Wachten op update-output...</pre>
    </section>
  </main>
  <script>
    (()=>{
      const key="fgbp-update-return-to";
      const safePath=value=>typeof value==="string"&&value.startsWith("/")&&!value.startsWith("//")&&!value.startsWith("/api/")?value:"/";
      const current=safePath(location.pathname+location.search);
      if(!sessionStorage.getItem(key))sessionStorage.setItem(key,current);
      let delay=1000,redirecting=false;
      const main=document.getElementById("main"),connection=document.getElementById("connection"),started=document.getElementById("started"),title=document.getElementById("title"),message=document.getElementById("message"),summaryTitle=document.getElementById("summary-title"),summaryText=document.getElementById("summary-text"),logPanel=document.getElementById("log-panel"),log=document.getElementById("log"),live=document.getElementById("live-state"),phaseLabel=document.getElementById("phase-label"),steps=[...document.querySelectorAll(".step")];
      const setPhase=value=>{const text=String(value||"");let index=0,label="Update voorbereiden";if(/pg_dump|prisma|migration|database|sqlite|postgres/i.test(text)){index=1;label="Database veilig bijwerken"}if(/pnpm run build|next build|compiled successfully/i.test(text)){index=2;label="Nieuwe applicatie bouwen"}if(/health check|returning the application|starting worker|update complete/i.test(text)){index=3;label="Installatie controleren"}phaseLabel.textContent=label;steps.forEach((step,i)=>step.classList.toggle("active",i<=index))};
      const apply=s=>{
        connection.textContent="Verbinding actief";
        started.textContent=s.startedAt?"Gestart: "+new Intl.DateTimeFormat("nl-NL",{dateStyle:"medium",timeStyle:"short"}).format(new Date(s.startedAt)):"";
        if(s.log!==null){logPanel.classList.add("visible");log.textContent=s.log||"Wachten op update-output...";setPhase(s.log);log.scrollTop=log.scrollHeight}else{logPanel.classList.remove("visible")}
        if(s.running){delay=1000;return}
        if(s.source==="application"&&!redirecting){redirecting=true;connection.textContent="Portal beschikbaar";summaryTitle.textContent="Update afgerond";summaryText.textContent="Je laatste pagina wordt hersteld.";setTimeout(()=>location.replace(safePath(s.returnTo)||safePath(sessionStorage.getItem(key))),500);return}
        if(s.outcome==="error"){main.classList.add("error");title.textContent="De portal blijft veilig in onderhoud";message.textContent="De update kon niet volledig worden afgerond. De beheerder kan dit herstellen zonder dat je opnieuw hoeft te proberen.";summaryTitle.textContent="Herstel wordt afgewacht";summaryText.textContent="Deze pagina blijft controleren wanneer de portal weer beschikbaar is.";live.textContent="Onderbroken"}
      };
      const poll=async()=>{try{const response=await fetch("/api/update/events?poll=1&t="+Date.now(),{cache:"no-store",credentials:"same-origin",headers:{Accept:"application/json"}});if(!response.ok)throw new Error("status");apply(await response.json());delay=1000}catch{connection.textContent="Opnieuw verbinden";delay=Math.min(5000,Math.round(delay*1.6))}finally{if(!redirecting)setTimeout(poll,delay)}};
      void poll();
    })();
  </script>
</body>
</html>`;
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key.startsWith("--")) throw new Error(`unknown argument: ${key}`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`missing value for ${key}`);
    options[key.slice(2)] = value;
    index += 1;
  }
  return options;
}

async function main() {
  const [command = "serve", ...rest] = process.argv.slice(2);
  const options = parseOptions(rest);
  const appDir = path.resolve(options["app-dir"] ?? process.env.APP_DIR ?? process.cwd());

  if (command === "begin") {
    await beginMaintenance({ appDir, operation: options.operation, returnTo: options["return-to"] });
    return;
  }
  if (command === "finalize") {
    const exitCode = Number.parseInt(options["exit-code"] ?? "1", 10);
    await finalizeMaintenance({ appDir, exitCode: Number.isInteger(exitCode) ? exitCode : 1 });
    return;
  }
  if (command === "probe") {
    await probe(options.url ?? "http://127.0.0.1:3000/api/health", Number.parseInt(options.retries ?? "20", 10));
    return;
  }
  if (command !== "serve") throw new Error(`unknown command: ${command}`);

  const host = options.host ?? process.env.HOST ?? "0.0.0.0";
  const port = Number.parseInt(options.port ?? process.env.PORT ?? "3000", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535");
  const server = createMaintenanceServer({ appDir });
  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  server.listen(port, host);
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
