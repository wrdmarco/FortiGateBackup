import Link from "next/link";
import { Shell } from "@/components/ui";
import { isSuperAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function BackupsPage() {
  const user = await requireUser();
  const backups = await prisma.backup.findMany({
    where: isSuperAdmin(user) ? {} : { fortigate: { customer: { tenantId: user.tenantId ?? "" } } },
    include: { fortigate: { include: { customer: true } } },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  return (
    <Shell>
      <h1 className="text-3xl font-semibold">Backups</h1>
      <div className="mt-6 overflow-auto rounded-md border border-border">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-3 py-2">Datum</th>
              <th className="px-3 py-2">Klant</th>
              <th className="px-3 py-2">FortiGate</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">SHA256</th>
              <th className="px-3 py-2">Grootte</th>
              <th className="px-3 py-2">Acties</th>
            </tr>
          </thead>
          <tbody>
            {backups.map((backup) => (
              <tr key={backup.id} className="border-t border-border">
                <td className="px-3 py-2">{backup.createdAt.toLocaleString("nl-NL")}</td>
                <td className="px-3 py-2">{backup.fortigate.customer.name}</td>
                <td className="px-3 py-2">{backup.fortigate.hostname ?? backup.fortigate.managementUrl}</td>
                <td className="px-3 py-2">{backup.status}</td>
                <td className="px-3 py-2 font-mono text-xs">{backup.sha256 ?? backup.error ?? "-"}</td>
                <td className="px-3 py-2">{backup.filesize}</td>
                <td className="flex flex-wrap gap-2 px-3 py-2">
                  {backup.filename ? (
                    <>
                      <Link
                        className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
                        href={`/api/backups/${backup.id}/download`}
                      >
                        Download
                      </Link>
                      <Link
                        className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
                        href={`/backups/${backup.id}/diff`}
                      >
                        Diff
                      </Link>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Geen bestand</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
