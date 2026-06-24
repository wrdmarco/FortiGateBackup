"use client";

export function DeleteConfirmInput() {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">Typ handmatig Delete ter bevestiging</span>
      <input
        className="rounded-md border border-red-300 bg-surface px-3 py-2 outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/15 dark:border-red-800"
        name="confirmDelete"
        autoComplete="off"
        required
        onPaste={(event) => event.preventDefault()}
        onDrop={(event) => event.preventDefault()}
        onContextMenu={(event) => event.preventDefault()}
      />
      <span className="text-xs text-muted-foreground">
        Plakken is uitgeschakeld voor dit veld. De tekst moet exact zijn: Delete
      </span>
    </label>
  );
}
