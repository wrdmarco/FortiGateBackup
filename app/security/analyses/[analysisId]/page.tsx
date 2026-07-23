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
  const informationalControls = parseStoredScoreComponents(analysis.scoreComponents).filter((component) => component.passed > 0);

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
      <TableShell className="mt-6">
        <table className="table-pro w-full min-w-[900px] text-left text-sm">
          <thead><tr><th>Severity</th><th>Regel</th><th>Uitleg</th><th>Veilig bewijs</th><th>Hersteladvies</th></tr></thead>
          <tbody>
            {[...analysis.findings].sort((left,right)=>severityRank(left.severity)-severityRank(right.severity)).map((finding) => (
              <tr className="border-t border-border align-top" key={finding.id}>
                <td><Badge tone={finding.severity === "CRITICAL" || finding.severity === "HIGH" ? "danger" : finding.severity === "MEDIUM" ? "warning" : "neutral"}>{finding.severity}</Badge></td>
                <td>{finding.ruleId}<br />{finding.title}</td>
                <td>{finding.explanation}</td>
                <td className="font-mono text-xs">{finding.evidence}</td>
                <td>{finding.remediation}</td>
              </tr>
            ))}
            {informationalControls.map((component) => (
              <tr className="border-t border-border align-top" key={`info-${component.ruleId}`}>
                <td><Badge tone="neutral">INFO</Badge></td>
                <td>{component.ruleId}<br />{component.title}</td>
                <td>Deze veilige controle heeft positief bijgedragen aan de technische score.</td>
                <td className="font-mono text-xs">{component.passed} van {component.passed + component.failed} toepasselijke controles geslaagd</td>
                <td>Geen herstelactie nodig voor de geslaagde controles.</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>
    </Shell>
  );
}

function severityRank(severity:string){return ["CRITICAL","HIGH","MEDIUM","LOW"].indexOf(severity);}
