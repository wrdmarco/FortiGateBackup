import { notFound } from "next/navigation";
import { acceptFortiGateCertificate } from "@/app/actions";
import { ActionLink, Button, PageHeader, Shell } from "@/components/ui";
import { assertOperationalTenant, assertTenantAccess, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { inspectFortiGateCertificate } from "@/lib/fortigate";

export const dynamic = "force-dynamic";

export default async function FortiGateCertificatePage({
  params
}: {
  params: Promise<{ id: string; fortigateId: string }>;
}) {
  const user = await requirePermission("fortigates.update");
  const { id, fortigateId } = await params;
  const device = await prisma.fortiGate.findFirst({
    where: { id: fortigateId, customerId: id },
    include: { customer: true }
  });
  if (!device) notFound();
  assertTenantAccess(user, device.customer.tenantId);
  await assertOperationalTenant(user, device.customer.tenantId);
  const detailHref = `/customers/${device.customerId}/fortigates/${device.id}`;

  let certificate;
  let inspectionError: string | null = null;
  try {
    certificate = await inspectFortiGateCertificate(device.managementUrl, device.httpsPort);
  } catch (error) {
    inspectionError = error instanceof Error ? error.message : "Het certificaat kon niet worden opgehaald.";
  }

  return (
    <Shell>
      <PageHeader
        title="TLS-certificaat controleren"
        description={`${device.hostname ?? device.managementUrl} · ${device.customer.name}`}
        actions={<ActionLink href={detailHref}>Terug naar FortiGate</ActionLink>}
      />
      <section className="max-w-3xl rounded-md border border-border bg-surface p-5 shadow-sm">
        {inspectionError ? (
          <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-950 dark:border-red-800 dark:bg-red-950 dark:text-red-100" role="alert">
            <p className="font-semibold">Certificaatcontrole mislukt</p>
            <p className="mt-2">{inspectionError}</p>
          </div>
        ) : certificate ? (
          <>
            <div className={`rounded-md border p-4 text-sm ${certificate.trusted ? "border-green-300 bg-green-50 text-green-950 dark:border-green-800 dark:bg-green-950 dark:text-green-100" : "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"}`}>
              <p className="font-semibold">
                {certificate.trusted ? "Certificaat is geldig en vertrouwd" : certificate.selfSigned ? "Self-signed certificaat" : "Certificaat is niet vertrouwd"}
              </p>
              <p className="mt-1">
                {certificate.trusted
                  ? "De volledige certificaatketen en hostnaam zijn geldig. Handmatige acceptatie is niet nodig."
                  : "Backups blijven geblokkeerd totdat je precies deze fingerprint expliciet accepteert."}
              </p>
            </div>
            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-[10rem_1fr]">
              <dt className="font-medium text-muted-foreground">Onderwerp</dt><dd className="break-all">{certificate.subject}</dd>
              <dt className="font-medium text-muted-foreground">Uitgever</dt><dd className="break-all">{certificate.issuer}</dd>
              <dt className="font-medium text-muted-foreground">Geldig vanaf</dt><dd>{new Date(certificate.validFrom).toLocaleString("nl-NL")}</dd>
              <dt className="font-medium text-muted-foreground">Geldig tot</dt><dd>{new Date(certificate.validTo).toLocaleString("nl-NL")}</dd>
              <dt className="font-medium text-muted-foreground">SHA-256</dt><dd className="break-all font-mono text-xs">{certificate.fingerprint}</dd>
              <dt className="font-medium text-muted-foreground">Validatie</dt><dd>{certificate.validationError ?? "Geldig"}</dd>
            </dl>
            {!certificate.trusted ? (
              device.tlsCertificateFingerprint === certificate.fingerprint ? (
                <p className="mt-5 rounded-md border border-green-300 bg-green-50 p-4 text-sm text-green-950 dark:border-green-800 dark:bg-green-950 dark:text-green-100">
                  Deze fingerprint is al expliciet geaccepteerd. Backups controleren hem bij iedere verbinding.
                </p>
              ) : (
                <form action={acceptFortiGateCertificate} className="mt-5 grid gap-4 border-t border-border pt-5">
                  <input type="hidden" name="id" value={device.id} />
                  <input type="hidden" name="fingerprint" value={certificate.fingerprint} />
                  <label className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                    <input className="mt-1 h-5 w-5 shrink-0" name="acceptCertificate" type="checkbox" value="true" required />
                    <span>Ik heb het certificaat buiten deze applicatie gecontroleerd en accepteer deze exacte SHA-256-fingerprint voor deze FortiGate.</span>
                  </label>
                  <div><Button>Certificaat eenmalig accepteren</Button></div>
                </form>
              )
            ) : null}
          </>
        ) : null}
      </section>
    </Shell>
  );
}
