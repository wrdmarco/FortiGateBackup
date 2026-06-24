"use client";

import { useState } from "react";
import { clsx } from "clsx";

type SettingsTab = {
  id: string;
  label: string;
  description?: string;
  content: React.ReactNode;
};

export function SettingsTabs({ tabs }: { tabs: SettingsTab[] }) {
  const [activeTab, setActiveTab] = useState(tabs[0]?.id ?? "");
  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  return (
    <div className="grid gap-5">
      <div className="overflow-x-auto rounded-md border border-border bg-surface p-1 shadow-sm">
        <div className="flex min-w-max gap-1" role="tablist" aria-label="Instellingen tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active?.id === tab.id}
              className={clsx(
                "rounded px-4 py-2 text-sm font-medium transition",
                active?.id === tab.id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {active?.description ? <p className="max-w-3xl text-sm text-muted-foreground">{active.description}</p> : null}

      {tabs.map((tab) => (
        <div key={tab.id} role="tabpanel" hidden={active?.id !== tab.id}>
          {tab.content}
        </div>
      ))}
    </div>
  );
}