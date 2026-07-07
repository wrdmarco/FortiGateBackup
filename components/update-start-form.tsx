"use client";

import { usePathname, useSearchParams } from "next/navigation";

export function UpdateStartForm({
  action,
  disabled,
  updateAvailable
}: {
  action: (formData: FormData) => void | Promise<void>;
  disabled: boolean;
  updateAvailable: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const returnTo = `${pathname}${query ? `?${query}` : ""}`;

  return (
    <form action={action}>
      <input type="hidden" name="returnTo" value={returnTo} />
      <button
        className={
          updateAvailable
            ? "inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/20 transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
            : "inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition hover:border-primary/45 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45"
        }
        disabled={disabled}
      >
        {updateAvailable ? "Check en update nu" : "Opnieuw checken / update starten"}
      </button>
    </form>
  );
}
