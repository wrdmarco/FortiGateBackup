"use client";

import { useEffect, useState } from "react";

type ThemeMode = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>("light");

  useEffect(() => {
    const stored = window.localStorage.getItem("fgbp-theme");
    const initial = stored === "dark" || stored === "light"
      ? stored
      : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    setTheme(initial);
    applyTheme(initial);
  }, []);

  function chooseTheme(nextTheme: ThemeMode) {
    setTheme(nextTheme);
    window.localStorage.setItem("fgbp-theme", nextTheme);
    applyTheme(nextTheme);
  }

  return (
    <div className="grid gap-2 px-3 py-3">
      <p className="text-xs font-semibold uppercase text-muted-foreground">Weergave</p>
      <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-muted p-1">
        <button
          className={theme === "light" ? activeClass : inactiveClass}
          onClick={() => chooseTheme("light")}
          type="button"
        >
          Licht
        </button>
        <button
          className={theme === "dark" ? activeClass : inactiveClass}
          onClick={() => chooseTheme("dark")}
          type="button"
        >
          Donker
        </button>
      </div>
    </div>
  );
}

function applyTheme(theme: ThemeMode) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

const activeClass = "rounded bg-surface px-2 py-1.5 text-xs font-semibold text-foreground shadow-sm";
const inactiveClass = "rounded px-2 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground";
