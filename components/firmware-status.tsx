import Link from "next/link";
import { checkFortiOsFirmware } from "@/lib/firmware-check";

export async function FirmwareStatus({ version }: { version?: string | null }) {
  const result = await checkFortiOsFirmware(version);
  const tone =
    result.status === "up-to-date"
      ? "border-green-300 text-green-700 dark:border-green-800 dark:text-green-300"
      : result.status === "update-available"
        ? "border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300"
        : "border-border text-muted-foreground";
  const label =
    result.status === "up-to-date"
      ? "Actueel"
      : result.status === "update-available"
        ? `Update ${result.latestVersion}`
        : "Onbekend";

  return (
    <span className={`inline-flex max-w-full items-center gap-2 rounded-md border px-2 py-1 text-xs ${tone}`}>
      <span>{label}</span>
      {result.sourceUrl ? (
        <Link className="underline" href={result.sourceUrl} target="_blank">
          Bron
        </Link>
      ) : null}
    </span>
  );
}
