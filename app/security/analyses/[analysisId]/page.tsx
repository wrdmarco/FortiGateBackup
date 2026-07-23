import { notFound } from "next/navigation";
import { ActionLink, Badge, Card, PageHeader, Shell, TableShell } from "@/components/ui";
import { requirePermission, tenantFilter } from "@/lib/authz";
import { parseStoredScoreComponents } from "@/lib/security/rules";
import { tenantTransaction } from "@/lib/tenant-db";

export const dynamic = "force-dynamic";

export default async function AnalysisPage({ params }: { params: Promise<{ analysisId: string }> }) {
  const user = await requirePermission("security.analyses.read");
  const tenantId = tenantFilter(user);
  if (!tenantId) notFound();
  const { analysisId } = await params;
  const analysis = await tenantTransaction(tenantId, (tx) => tx.securityAnalysis.findFirst({
    where: { id: analysisId, tenantId },
    include: { findings: true, report: true, fortigate: { include: { customer: true } }, sourceBackup: true }
  }));
  if (!analysis) notFound();

  const successfulControls = parseStoredScoreComponents(analysis.scoreComponents).filter((component) => component.passed > 0);

  return (
    <Shell>
      <PageHeader
        title={`Analyse ${analysis.configSha256.slice(0, 12)}`}
        description={`${analysis.fortigate.customer.name} - ${analysis.fortigate.hostname ?? "FortiGate"}`}
        actions={analysis.report ? <ActionLink href={`/api/security/reports/${analysis.report.id}`} variant="primary">PDF downloaden</ActionLink> : undefined}
      />
      <div className="grid gap-4 sm:grid-cols-4">
        <Card title="Status" value={analysis.status} />
        <Card title="Score" value={analysis.score === null ? "-" : `${analysis.score}%`} />
        <Card title="Critical" value={analysis.criticalCount} />
        <Card title="High" value={analysis.highCount} />
      </div>
      {analysis.safeSummary ? (
        <section className="mt-6 rounded-xl border border-border bg-surface p-5">
          <h2 className="font-display text-xl font-semibold">Managementsamenvatting</h2>
          <p className="mt-3 max-w-4xl whitespace-pre-wrap leading-7">{analysis.safeSummary}</p>
        </section>
      ) : null}
      {successfulControls.length ? (
        <section className="mt-6 rounded-xl border border-border bg-surface p-5 shadow-panel">
          <h2 className="font-display text-xl font-semibold">Geslaagde controles</h2>
          <p className="mt-1 text-sm text-muted-foreground">Veilige instellingen die aantoonbaar hebben bijgedragen aan de technische score.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {successfulControls.map((component) => (
              <article className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900 dark:bg-emerald-950/45" key={component.ruleId}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-emerald-700 dark:text-emerald-300">{component.category}</p>
                    <h3 className="mt-1 font-semibold text-foreground">{component.title}</h3>
                  </div>
                  <Badge tone="success">{component.passed} van {component.passed + component.failed}</Badge>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <TableShell className="mt-6">
        <table className="table-pro w-full min-w-[900px] text-left text-sm">
          <thead><tr><th>Severity</th><th>Regel</th><th>Uitleg</th><th>Veilig bewijs</th><th>Hersteladvies</th></tr></thead>
          <tbody>
            {analysis.findings.map((finding) => (
              <tr className="border-t border-border align-top" key={finding.id}>
                <td><Badge tone={finding.severity === "CRITICAL" || finding.severity === "HIGH" ? "danger" : finding.severity === "MEDIUM" ? "warning" : "neutral"}>{finding.severity}</Badge></td>
                <td>{finding.ruleId}<br />{finding.title}</td>
                <td>{finding.explanation}</td>
                <td className="font-mono text-xs">{finding.evidence}</td>
                <td>{finding.remediation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>
    </Shell>
  );
}
