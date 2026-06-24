"use client";

import { useEffect, useRef } from "react";

export function Modal({
  title,
  description,
  trigger,
  children,
  defaultOpen = false
}: {
  title: string;
  description?: string;
  trigger: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (defaultOpen && !dialogRef.current?.open) dialogRef.current?.showModal();
  }, [defaultOpen]);

  return (
    <>
      <span
        role="button"
        tabIndex={0}
        onClick={() => dialogRef.current?.showModal()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") dialogRef.current?.showModal();
        }}
        className="contents"
      >
        {trigger}
      </span>
      <dialog
        ref={dialogRef}
        className="w-[min(94vw,1040px)] rounded-lg border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-slate-950/60 backdrop:backdrop-blur-sm"
        onClick={(event) => {
          if (event.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <div className="border-b border-border bg-surface-soft px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
              {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
            </div>
            <button
              type="button"
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => dialogRef.current?.close()}
            >
              Sluiten
            </button>
          </div>
        </div>
        <div className="max-h-[78vh] overflow-auto p-6">{children}</div>
      </dialog>
    </>
  );
}
