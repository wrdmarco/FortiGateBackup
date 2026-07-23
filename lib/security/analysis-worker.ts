import { randomUUID } from "node:crypto";
import { SecurityAnalysisJobStatus, SecurityAnalysisStatus } from "@prisma/client";
import { auditLog } from "@/lib/audit";
import { sha256 } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { tenantTransaction } from "@/lib/tenant-db";
import { verifyImmutableArtifact } from "./artifact-storage";
import { enrichWithFoundry } from "./foundry";
import { getUsableFoundryConfig } from "./foundry-config";
import { FORTIOS_PARSER_VERSION, parseFortiOsConfig } from "./fortios-parser";
import { generateSecurityReport } from "./report";
import { evaluateFortiOs } from "./rules";
import { createSafeFoundryPayload, safePayloadDigest } from "./safe-foundry";

const WORKER_ID = `analysis-${process.pid}-${randomUUID()}`;
const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 4;
type Claimed = { id: string; tenantId: string; analysisId: string; fortigateId: string; attempts: number };

export async function processSecurityAnalysisJobs() {
  for (;;) {
    const job = await claim();
    if (!job) return;
    await execute(job);
  }
}

async function claim() {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.worker','1',true)`;
    const rows = await tx.$queryRaw<Claimed[]>`
      WITH candidate AS (
        SELECT id FROM "SecurityAnalysisJob"
        WHERE (status='PENDING' AND "availableAt"<=now())
           OR (status='RUNNING' AND "leaseExpiresAt"<now())
        ORDER BY "availableAt","createdAt"
        FOR UPDATE SKIP LOCKED LIMIT 1
      )
      UPDATE "SecurityAnalysisJob" j
      SET status='RUNNING',"workerId"=${WORKER_ID},"leaseExpiresAt"=now()+interval '60 seconds',
          "heartbeatAt"=now(),attempts=attempts+1,"updatedAt"=now()
      FROM candidate WHERE j.id=candidate.id
      RETURNING j.id,j."tenantId",j."analysisId",j."fortigateId",j.attempts
    `;
    return rows[0] ?? null;
  });
}

async function execute(job: Claimed) {
  const heartbeat = setInterval(() => void heartbeatJob(job).catch(() => undefined), 20_000);
  heartbeat.unref();
  try {
    await progress(job, "CLAIMED", "Analysejob is door de worker opgepakt.");
    const data = await tenantTransaction(job.tenantId, async (tx) => {
      const analysis = await tx.securityAnalysis.findUniqueOrThrow({
        where: { tenantId_id: { tenantId: job.tenantId, id: job.analysisId } },
        include: { configArtifact: true, sourceBackup: true, fortigate: { include: { customer: { include: { tenant: true } } } } }
      });
      if (analysis.status === SecurityAnalysisStatus.COMPLETED) return null;
      await tx.securityAnalysis.update({
        where: { id: analysis.id },
        data: { status: SecurityAnalysisStatus.RUNNING, startedAt: analysis.startedAt ?? new Date(), errorCode: null, parserVersion: FORTIOS_PARSER_VERSION }
      });
      return analysis;
    });
    if (!data) return;

    await progress(job, "CONFIGURATION", "Tenantgebonden Foundry-configuratie wordt gecontroleerd.");
    const config = await getUsableFoundryConfig(job.tenantId);
    if (!config) throw new Error("REPORTING_NOT_CONFIGURED");

    await progress(job, "ARTIFACT_VERIFY", "Immutable configuratiehash en bestandsgrootte worden gecontroleerd.");
    const content = await verifyImmutableArtifact(data.configArtifact.path, data.configArtifact.sha256, data.configArtifact.filesize);

    await progress(job, "LOCAL_PARSE", "FortiOS-configuratie wordt uitsluitend lokaal geparsed.");
    const parsed = parseFortiOsConfig(content.toString("utf8"));
    if (parsed.digest !== data.configSha256) throw new Error("ARTIFACT_INTEGRITY_FAILED");

    await progress(job, "LOCAL_RULES", "Deterministische beveiligingsregels en score worden lokaal berekend.");
    const local = evaluateFortiOs(parsed);
    const payload = createSafeFoundryPayload({
      version: parsed.version,
      score: local.score,
      findings: local.findings,
      counts: {
        policies: parsed.nodes.filter((node) => node.path.endsWith("firewall policy")).length,
        interfaces: parsed.nodes.filter((node) => node.path.endsWith("system interface")).length,
        vdoms: new Set(parsed.nodes.map((node) => node.vdom)).size
      }
    });

    await progress(job, "FOUNDRY", "Geredigeerde allowlistgegevens worden door Azure Foundry verrijkt.");
    const enrichment = await enrichWithFoundry(config, payload);
    const previous = await tenantTransaction(job.tenantId, (tx) => tx.securityAnalysis.findFirst({
      where: {
        tenantId: job.tenantId,
        fortigateId: job.fortigateId,
        status: SecurityAnalysisStatus.COMPLETED,
        sourceBackup: { createdAt: { lt: data.sourceBackup.createdAt } }
      },
      orderBy: { sourceBackup: { createdAt: "desc" } },
      include: { findings: { select: { ruleId: true } } }
    }));
    const previousIds = new Set(previous?.findings.map((finding) => finding.ruleId) ?? []);
    const currentIds = new Set(local.findings.map((finding) => finding.ruleId));
    const newFindingIds = [...currentIds].filter((id) => !previousIds.has(id));
    const resolvedFindingIds = [...previousIds].filter((id) => !currentIds.has(id));

    await progress(job, "PDF_REPORT", "Het immutable Nederlandstalige PDF-rapport wordt lokaal opgebouwd.");
    const reportId = randomUUID();
    const report = await generateSecurityReport({
      reportId,
      tenantId: job.tenantId,
      tenantName: data.fortigate.customer.tenant.name,
      customerName: data.fortigate.customer.name,
      fortigateId: job.fortigateId,
      hostname: data.fortigate.hostname ?? "FortiGate",
      model: data.fortigate.model ?? "Onbekend",
      fortiOsVersion: parsed.version,
      configDate: data.sourceBackup.createdAt,
      analysisDate: new Date(),
      score: local.score,
      scoreDelta: typeof previous?.score === "number" ? local.score - previous.score : null,
      hash: data.configSha256,
      parserVersion: data.parserVersion,
      rulesetVersion: data.rulesetVersion,
      summary: enrichment.managementSummary,
      findings: local.findings,
      newFindingIds,
      resolvedFindingIds
    });

    await progress(job, "PERSIST", "Bevindingen, score en rapportintegriteit worden atomisch vastgelegd.");
    await tenantTransaction(job.tenantId, async (tx) => {
      await tx.securityFinding.createMany({
        data: local.findings.map((finding) => ({
          ...finding,
          tenantId: job.tenantId,
          analysisId: job.analysisId,
          severity: finding.severity
        }))
      });
      await tx.securityAnalysisReport.create({
        data: {
          id: reportId,
          tenantId: job.tenantId,
          analysisId: job.analysisId,
          path: report.relative,
          sha256: sha256(report.buffer),
          filesize: report.buffer.byteLength
        }
      });
      const count = (severity: string) => local.findings.filter((finding) => finding.severity === severity).length;
      await tx.securityAnalysis.update({
        where: { id: job.analysisId },
        data: {
          status: SecurityAnalysisStatus.COMPLETED,
          score: local.score,
          criticalCount: count("CRITICAL"),
          highCount: count("HIGH"),
          mediumCount: count("MEDIUM"),
          lowCount: count("LOW"),
          scoreComponents: JSON.stringify(local.findings.map((finding) => ({ ruleId: finding.ruleId, penalty: finding.penalty }))),
          safeSummary: enrichment.managementSummary,
          redactionStats: JSON.stringify({
            payloadSha256: safePayloadDigest(payload),
            payloadBytes: Buffer.byteLength(JSON.stringify(payload))
          }),
          durationMs: enrichment.durationMs,
          completedAt: new Date()
        }
      });
      await tx.securityAnalysisJob.update({
        where: { id: job.id },
        data: { status: SecurityAnalysisJobStatus.COMPLETED, finishedAt: new Date(), workerId: null, leaseExpiresAt: null }
      });
      await tx.securityAnalysisJobEvent.create({
        data: { tenantId: job.tenantId, jobId: job.id, stage: "COMPLETED", message: "Analyse en immutable PDF zijn succesvol voltooid." }
      });
    });
    await auditLog({
      action: "security.analysis.completed",
      tenantId: job.tenantId,
      entity: "SecurityAnalysis",
      entityId: job.analysisId,
      metadata: { score: local.score, reportId, deployment: data.foundryDeployment }
    });
  } catch (error) {
    await fail(job, error instanceof Error ? error.message : "ANALYSIS_FAILED");
  } finally {
    clearInterval(heartbeat);
  }
}

async function progress(job: Claimed, stage: string, message: string) {
  await tenantTransaction(job.tenantId, async (tx) => {
    await tx.securityAnalysisJobEvent.create({ data: { tenantId: job.tenantId, jobId: job.id, stage, message } });
    await tx.securityAnalysisJob.updateMany({
      where: { id: job.id, status: SecurityAnalysisJobStatus.RUNNING, workerId: WORKER_ID },
      data: { heartbeatAt: new Date(), leaseExpiresAt: new Date(Date.now() + LEASE_MS) }
    });
  });
}

async function heartbeatJob(job: Claimed) {
  await tenantTransaction(job.tenantId, async (tx) => {
    await tx.securityAnalysisJob.updateMany({
      where: { id: job.id, status: SecurityAnalysisJobStatus.RUNNING, workerId: WORKER_ID },
      data: { heartbeatAt: new Date(), leaseExpiresAt: new Date(Date.now() + LEASE_MS) }
    });
  });
}

async function fail(job: Claimed, code: string) {
  const safe = /^[A-Z0-9_]{3,80}$/.test(code) ? code : "ANALYSIS_FAILED";
  const retry = job.attempts < MAX_ATTEMPTS && !["FOUNDRY_AUTH_INVALID", "REPORTING_NOT_CONFIGURED", "SENSITIVE_DATA_DETECTED"].includes(safe);
  await tenantTransaction(job.tenantId, async (tx) => {
    await tx.securityAnalysisJob.update({
      where: { id: job.id },
      data: {
        status: retry ? SecurityAnalysisJobStatus.PENDING : safe === "REPORTING_NOT_CONFIGURED" ? SecurityAnalysisJobStatus.BLOCKED : SecurityAnalysisJobStatus.FAILED,
        availableAt: new Date(Date.now() + Math.min(300_000, 15_000 * 2 ** job.attempts)),
        workerId: null,
        leaseExpiresAt: null,
        errorCode: safe,
        ...(!retry ? { finishedAt: new Date() } : {})
      }
    });
    await tx.securityAnalysis.update({
      where: { id: job.analysisId },
      data: {
        status: retry ? SecurityAnalysisStatus.PENDING : safe === "REPORTING_NOT_CONFIGURED" ? SecurityAnalysisStatus.BLOCKED : SecurityAnalysisStatus.FAILED,
        errorCode: safe
      }
    });
    await tx.securityAnalysisJobEvent.create({
      data: {
        tenantId: job.tenantId,
        jobId: job.id,
        stage: retry ? "RETRY_SCHEDULED" : "FAILED",
        message: retry ? "Analyse is veilig opnieuw ingepland." : analysisErrorMessage(safe)
      }
    });
  });
  await auditLog({
    action: safe === "SENSITIVE_DATA_DETECTED" ? "security.analysis.secret_preflight_blocked" : "security.analysis.failed",
    tenantId: job.tenantId,
    entity: "SecurityAnalysis",
    entityId: job.analysisId,
    outcome: "failure",
    reason: safe
  });
}

function analysisErrorMessage(code: string) {
  const messages: Record<string, string> = {
    FOUNDRY_AUTH_INVALID: "Azure Foundry heeft de tenantcredentials geweigerd.",
    REPORTING_NOT_CONFIGURED: "Tenantrapportage is niet volledig geconfigureerd.",
    SENSITIVE_DATA_DETECTED: "De veilige egresscontrole heeft de netwerkcall geblokkeerd.",
    ARTIFACT_INTEGRITY_FAILED: "De configuratie-integriteitscontrole is mislukt.",
    FORTIOS_UNTERMINATED_QUOTE: "De FortiOS-configuratie bevat een werkelijk onafgesloten quoted waarde."
  };
  return messages[code] ?? "Analyse is gestopt met een gesanitiseerde technische fout.";
}
