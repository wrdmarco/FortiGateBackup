import Link from "next/link";
import { clsx } from "clsx";

type SettingsTab = {
  id: string;
  label: string;
  href: string;
  description?: string;
  content: React.ReactNode;
};

export function SettingsTabs({ tabs, activeTab }: { tabs: SettingsTab[]; activeTab: string }) {
  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  return (
    <div className="grid gap-5">
      <div className="overflow-x-auto rounded-md border border-border bg-surface p-1 shadow-sm">
        <div className="flex min-w-max gap-1" role="tablist" aria-label="Instellingen tabs">
          {tabs.map((tab) => (
            <Link
              key={tab.id}
              role="tab"
              aria-selected={active?.id === tab.id}
              className={clsx(
                "rounded px-4 py-2 text-sm font-medium transition",
                active?.id === tab.id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              href={tab.href}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>

      {active?.description ? <p className="max-w-3xl text-sm text-muted-foreground">{active.description}</p> : null}

      <div role="tabpanel">{active?.content}</div>
    </div>
  );
}