import { deleteFoundryConfigAction, saveFoundryConfigAction } from "@/app/security/actions";
import { Button, Field, Panel } from "@/components/ui";

type FoundrySettings = { enabled: boolean; endpoint: string; deployment: string; hasApiKey: boolean } | null;

export function FoundrySettingsPanel({ tenantId, config, error, saved }: { tenantId: string; config: FoundrySettings; error?: string; saved?: string }) {
  const errorMessage = error === "invalid-endpoint"
    ? "Het endpoint hoort bij een niet-ondersteunde host of bevat geen geldige Foundry-projectnaam. Gebruik een Azure OpenAI-resource- of Azure Foundry-projectendpoint."
    : error === "invalid-deployment"
      ? "De deploymentnaam is ongeldig. Gebruik uitsluitend letters, cijfers, punten, underscores en koppeltekens."
      : error === "missing-key" ? "Vul een API-key in om de configuratie voor het eerst op te slaan." : null;
  return <div className="grid gap-4">
    {errorMessage ? <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">{errorMessage}</div> : null}
    {saved === "1" ? <div role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-300">De Foundry-configuratie is veilig opgeslagen.</div> : null}
    <Panel title="Foundry v1-configuratie" description="Tenantgebonden AI-verrijking via ondersteunde Azure-hostnamen en HTTPS.">
      <form action={saveFoundryConfigAction} className="grid max-w-3xl gap-4">
        <input type="hidden" name="tenantId" value={tenantId} />
        <label className="flex min-h-11 items-center gap-3"><input type="hidden" name="enabled" value="false" /><input type="checkbox" name="enabled" value="true" defaultChecked={config?.enabled} />Rapportage actief</label>
        <Field label="Azure Foundry endpoint" name="endpoint" type="url" required defaultValue={config?.endpoint ?? ""} />
        <p className="text-sm text-muted-foreground">Je mag een volledige Azure API-URL plakken. FortiBackup verwijdert veilig deployment- en API-routes, queryparameters en trailing slashes en slaat alleen het canonieke endpoint op.</p>
        <Field label="Deploymentnaam" name="deployment" required defaultValue={config?.deployment ?? ""} />
        <Field label={config?.hasApiKey ? "Nieuwe API-key (leeg laten om te behouden)" : "API-key"} name="apiKey" type="password" required={!config?.hasApiKey} autoComplete="new-password" />
        <p className="text-sm text-muted-foreground">Opgeslagen key: {config?.hasApiKey ? "••••••••" : "geen"}</p>
        <Button>Configuratie opslaan</Button>
      </form>
      {config ? <form action={deleteFoundryConfigAction} className="mt-6"><input type="hidden" name="tenantId" value={tenantId} /><Button variant="danger">Configuratie en key verwijderen</Button></form> : null}
    </Panel>
  </div>;
}
