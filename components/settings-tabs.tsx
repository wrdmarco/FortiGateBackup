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
    <div className="grid gap-4">
      <div className="overflow-x-auto border-b border-border">
        <div className="flex min-w-max gap-6" role="tablist" aria-label="Instellingen tabs">
          {tabs.map((tab) => (
            <Link
              key={tab.id}
              role="tab"
              aria-selected={active?.id === tab.id}
              className={clsx(
                "relative min-h-11 px-0 py-3 text-sm font-semibold transition after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:transition",
                active?.id === tab.id
                  ? "text-foreground after:bg-primary"
                  : "text-muted-foreground after:bg-transparent hover:text-foreground"
              )}
              href={tab.href}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>

      {active?.description ? <p className="max-w-5xl text-sm text-muted-foreground">{active.description}</p> : null}

      <div role="tabpanel">{active?.content}</div>
    </div>
  );
}
