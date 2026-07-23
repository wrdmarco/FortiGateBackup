import { ActionLink, Badge, Card, PageHeader, Shell, TableShell } from "@/components/ui";
import { requirePermission, tenantFilter } from "@/lib/authz";
import { hasPermission } from "@/lib/rbac";
import { maskedFoundryConfig } from "@/lib/security/foundry-config";
import { tenantSecurityOverview } from "@/lib/security/queries";
import { retryAnalysisAction, startSecurityAnalysisAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const user = await requirePermission("security.analyses.read");
  const tenantId = tenantFilter(user);
  if (!tenantId) throw new Error("Selecteer een klanttenant.");

  const [overview, canRun, foundry] = await Promise.all([
    tenantSecurityOverview(tenantId),
    hasPermission(user, "security.analyses.run"),
    maskedFoundryConfig(tenantId)
  ]);
  const reportingConfigured = Boolean(foundry?.enabled && foundry.hasApiKey && foundry.endpoint && foundry.deployment);

  return (
    <Shell>
      <PageHeader
        title="FortiGate beveiliging"
        description="Actuele, tenantgebonden analyse van de nieuwste gewijzigde configuratie per FortiGate."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card title="Gemiddelde score" value={overview.average === null ? "Niet beschikbaar" : `${overview.average}%`} />
        <Card title="Scoretrend" value={overview.trend === null ? "Niet beschikbaar" : `${overview.trend >= 0 ? "+" : ""}${overview.trend}`} />
        <Card title="Analysedekking" value={`${overview.coverage.analysed} van ${overview.coverage.total}`} />
        <Card title="Critical / high" value={`${overview.critical} / ${overview.high}`} />
        <Card title="Onder drempel" value={overview.belowThreshold} detail="Score lager dan 70" />
        <Card title="In behandeling" value={overview.pending} />
        <Card title="Mislukt / geblokkeerd" value={overview.failed} />
      </div>
      <TableShell className="mt-6">
        <table className="table-pro w-full min-w-[760px] text-left text-sm">
          <thead><tr><th>FortiGate</th><th>Nieuwste wijziging</th><th>Status</th><th>Score</th><th>Actie</th></tr></thead>
          <tbody>
            {overview.devices.map(({ device, backup, analysis }) => (
              <tr key={device.id} className="border-t border-border">
                <td>{device.hostname ?? device.id}</td>
                <td>{backup ? backup.createdAt.toLocaleString("nl-NL", { timeZone: "UTC" }) : "Geen gewijzigde backup"}</td>
                <td>
                  <Badge tone={analysis?.status === "COMPLETED" ? "success" : analysis?.status === "FAILED" || analysis?.status === "BLOCKED" ? "danger" : "warning"}>
                    {!analysis ? "Niet geanalyseerd" : analysis.status}
                  </Badge>
                </td>
                <td>{analysis?.status === "COMPLETED" && analysis.score !== null ? `${analysis.score}%` : "-"}</td>
                <td>
                  <div className="flex flex-wrap gap-2">
                    <ActionLink href={`/customers/${device.customerId}/fortigates/${device.id}/security`}>Historie</ActionLink>
                    {canRun && backup && !analysis && reportingConfigured ? (
                      <form action={startSecurityAnalysisAction}>
                        <input type="hidden" name="fortigateId" value={device.id} />
                        <button type="submit" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90">
                          Analyse starten
                        </button>
                      </form>
                    ) : null}
                    {canRun && backup && !analysis && !reportingConfigured ? <Badge tone="warning">Rapportage niet geconfigureerd</Badge> : null}
                    {canRun && reportingConfigured && (analysis?.status === "FAILED" || analysis?.status === "BLOCKED") ? (
                      <form action={retryAnalysisAction}>
                        <input type="hidden" name="analysisId" value={analysis.id} />
                        <button type="submit" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90">
                          Opnieuw proberen
                        </button>
                      </form>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>
    </Shell>
  );
}
