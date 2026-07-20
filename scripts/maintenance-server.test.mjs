import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildSnapshot,
  createMaintenanceServer,
  finalizeMaintenance,
  hashViewerToken
} from "./maintenance-server.mjs";

test("maintenance server protects logs and reports a healthy maintenance endpoint", async (context) => {
  const appDir = await mkdtemp(path.join(tmpdir(), "fgbp-maintenance-"));
  const logsDir = path.join(appDir, "data", "logs");
  await mkdir(logsDir, { recursive: true });
  const viewerToken = "test-viewer-token";
  await writeFile(
    path.join(logsDir, "update-status.json"),
    JSON.stringify({
      schemaVersion: 1,
      operation: "update",
      outcome: "running",
      startedAt: "2026-07-14T10:00:00.000Z",
      startedByUserId: "user-1",
      returnTo: "/settings?tab=updates",
      viewerTokenHash: hashViewerToken(viewerToken),
      finishedAt: null,
      exitCode: null
    })
  );
  await writeFile(path.join(logsDir, "update.lock"), "1\n");
  await writeFile(path.join(logsDir, "update.log"), "private update output\n");

  const server = createMaintenanceServer({ appDir });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(appDir, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${origin}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, "maintenance");

  const anonymous = await fetch(`${origin}/api/update/events?poll=1`);
  assert.equal(anonymous.status, 200);
  assert.equal((await anonymous.json()).log, null);

  const viewer = await fetch(`${origin}/api/update/events?poll=1`, {
    headers: { Cookie: `fgbp_update_viewer=${viewerToken}` }
  });
  const viewerStatus = await viewer.json();
  assert.match(viewerStatus.log, /private update output/);
  assert.equal(viewerStatus.returnTo, "/settings?tab=updates");

  const html = await fetch(`${origin}/customers/acme`);
  assert.equal(html.status, 200);
  assert.match(await html.text(), /De portal wordt veilig bijgewerkt/);
  assert.match(html.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
});

test("finalize marks the operation and removes the lock atomically", async (context) => {
  const appDir = await mkdtemp(path.join(tmpdir(), "fgbp-maintenance-finalize-"));
  const logsDir = path.join(appDir, "data", "logs");
  await mkdir(logsDir, { recursive: true });
  await writeFile(
    path.join(logsDir, "update-status.json"),
    JSON.stringify({ outcome: "running", operation: "rollback", startedAt: "2026-07-14T10:00:00.000Z", returnTo: "/" })
  );
  await writeFile(path.join(logsDir, "update.lock"), "1\n");
  context.after(() => rm(appDir, { recursive: true, force: true }));

  await finalizeMaintenance({ appDir, exitCode: 7 });
  const snapshot = await buildSnapshot({ appDir });
  assert.equal(snapshot.running, false);
  assert.equal(snapshot.outcome, "error");
  assert.equal(snapshot.operation, "rollback");
});
