import { clsx } from "clsx";

export function BrandWordmark({ inverse = false, size = "default" }: { inverse?: boolean; size?: "compact" | "default" | "large" }) {
  return (
    <span
      aria-label="Forti Backup"
      className={clsx(
        "inline-flex items-center whitespace-nowrap font-sans font-semibold uppercase leading-none",
        size === "compact" && "text-[0.78rem]",
        size === "default" && "text-[0.86rem]",
        size === "large" && "text-lg"
      )}
    >
      <span aria-hidden className="font-extrabold tracking-[0.06em] text-[#e32636]">Forti</span>
      <span aria-hidden className={clsx("ml-[0.42em] font-semibold tracking-[0.1em]", inverse ? "text-white" : "text-foreground")}>Backup</span>
    </span>
  );
}
