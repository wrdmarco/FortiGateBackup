# FortiGate Backup Portal

Productiegericht MSP-portaal voor centraal beheer van FortiGate configuratiebackups.

## Functionaliteit

- Multi-tenant beheer met strikte tenantisolatie
- Eerste tenant via `/setup`
- Nieuwe tenants via het menu `Tenants`, alleen zichtbaar voor `SUPER_ADMIN`
- Per tenant klanten, FortiGates, backups, instellingen en auditlogs
- Lokale login met beveiligde sessiecookies
- FortiGate REST API backupflow met SHA256-deduplicatie
- Firmwarehistorie, audit logging en per-FortiGate backuplogs
- Online FortiOS firmwarecheck tegen Fortinet Document Library release notes
- SMTP en Microsoft Graph mailconfiguratie via database-instellingen
- Health endpoint voor monitoring
- Systemd services voor webapp en scheduler-worker
- GitHub Actions CI voor buildvalidatie

## Stack

- Ubuntu 24.04
- Next.js 15
- TypeScript
- Prisma
- SQLite standaard, PostgreSQL-ready via `DATABASE_URL`
- pnpm
- Tailwind CSS
- node-cron

## Configuratie

Alle applicatie-instellingen worden in de database beheerd. Alleen technische bootstrap- en deploymentwaarden horen in `.env`:

```bash
DATABASE_URL="file:../data/app.db"
NEXTAUTH_SECRET=""
ENCRYPTION_KEY=""
SERVER_URL=""
```

Tijdens `setup.sh` worden lege of ontbrekende waarden voor `NEXTAUTH_SECRET` en `ENCRYPTION_KEY` automatisch veilig gegenereerd. Bestaande waarden worden niet overschreven.

Per tenant kan een eigen publieke portal-URL in de database worden ingesteld via `Instellingen` > `Configuratie` > `Portal`. Laat deze leeg om terug te vallen op de globale portal-URL of `SERVER_URL`.

Tijdens setup wordt gevraagd naar de publieke server-URL. Als je alleen een domeinnaam invult, wordt automatisch `https://` toegevoegd en wordt de waarde direct in `.env` opgeslagen. Gebruik `SERVER_URL` wanneer de app achter een reverse proxy op een publieke host draait:

```bash
SERVER_URL="https://portal.example.nl"
```

## Installatie

```bash
git clone https://github.com/wrdmarco/FortiGateBackup.git
cd FortiGateBackup
corepack enable
chmod +x setup.sh update.sh rollback.sh uninstall.sh
./setup.sh
```

`setup.sh` installeert de applicatie standaard naar:

```bash
/opt/fortigate-backup
```

Je kunt dit aanpassen met:

```bash
APP_DIR=/opt/mijn-pad ./setup.sh
```

Na installatie open je:

```text
http://localhost:3000/setup
```

Maak daar de eerste tenant en super-admin aan.

## Tenantbeheer

Na de eerste setup beheert alleen een `SUPER_ADMIN` nieuwe tenants via:

```text
/tenants
```

Bij het aanmaken van een tenant maak je direct de eerste tenantadmin aan. Die gebruiker krijgt rol `ADMIN` en kan uitsluitend data binnen zijn eigen tenant beheren. Directe API-calls en server actions controleren dezelfde tenantgrenzen.

## FortiGate API-token

Voor FortiGate backups gebruikt het portaal een bearer API-token. Je hoeft in het portaal geen aparte API-gebruikersnaam op te geven: de token is op de FortiGate zelf al gekoppeld aan een admin/API-user met het juiste admin profile. Sla alleen de token op in het portaal.

## IT Glue integratie

IT Glue wordt per scope ingesteld via:

```text
Instellingen > Configuratie > IT Glue
```

Vul daar de API base URL en API key in. De API key wordt versleuteld in de database opgeslagen en komt niet in `.env` of GitHub terecht.

Wanneer IT Glue actief is, zijn extra koppelingen verplicht:

- Bij klanten: `IT Glue organization ID`
- Bij FortiGates: `IT Glue configuration ID`

Bij iedere backup met status `CHANGED` uploadt het portaal het nieuwe configuratiebestand als bijlage naar de gekoppelde IT Glue configuration. Als IT Glue de upload weigert of niet bereikbaar is, blijft de lokale backup behouden en verschijnt de fout in de FortiGate logs.
## Backuplogs

Elke FortiGate krijgt eigen operationele logregels voor inventory en backupstappen. In het FortiGate-overzicht zie je de laatste logregel per device. Voor diepere troubleshooting is beschikbaar:

```text
GET /api/fortigates/{id}/logs?limit=50
```

De logs bevatten stapnaam, niveau, melding en beperkte metadata zoals bytes, scope en bestandsnaam. API-tokens en configuratie-inhoud worden niet gelogd.

## Updates

```bash
./update.sh
```

De updateflow maakt eerst een self-backup, voert daarna `git pull`, `pnpm install`, Prisma migrations, build en service restart uit. `setup.sh` plaatst een beperkte sudoers-regel zodat de portal alleen de FortiGate Backup services mag herstarten na een update.

Voor een bestaande installatie waar de updateknop meldt dat `systemctl` niet via sudo mag, draai eenmalig als root:

```bash
cat >/etc/sudoers.d/fortigate-backup-update <<'EOF'
fortigate-backup ALL=(root) NOPASSWD: /usr/bin/systemctl daemon-reload
fortigate-backup ALL=(root) NOPASSWD: /usr/bin/systemctl restart fortigate-backup
fortigate-backup ALL=(root) NOPASSWD: /usr/bin/systemctl restart fortigate-backup-worker
fortigate-backup ALL=(root) NOPASSWD: /usr/bin/systemctl restart fortigate-backup fortigate-backup-worker
EOF
chmod 440 /etc/sudoers.d/fortigate-backup-update
visudo -cf /etc/sudoers.d/fortigate-backup-update
systemctl daemon-reload
systemctl restart fortigate-backup fortigate-backup-worker
```

## Break-glass toegang voor SSO herstel

Als Microsoft Entra ID SSO verkeerd staat ingesteld en normale login niet meer werkt, kan op de server een eenmalige link worden gemaakt voor Global instellingen. Deze toegang is alleen bedoeld om `Instellingen > SSO` te openen en bijvoorbeeld SSO uit te zetten.

Maak de link vanaf de applicatiemap:

```bash
cd /opt/fortigate-backup
pnpm break-glass:settings
```

Optioneel kan een specifieke Global super-admin worden gekozen:

```bash
pnpm break-glass:settings -- --email=admin@example.nl
```

Als `SERVER_URL` of de globale portal-URL niet goed staat, geef de publieke URL expliciet mee:

```bash
pnpm break-glass:settings -- --base-url=https://portal.example.nl
```

Eigenschappen van deze link:

- geldig voor 15 minuten
- eenmalig bruikbaar
- token wordt alleen gehasht in de database opgeslagen
- sessie is beperkt tot Global SSO-instellingen
- alle andere pagina's worden teruggestuurd naar `/settings?tab=sso`

Na gebruik zet je SSO uit via:

```text
Instellingen > SSO > Microsoft Entra ID SSO
```

Log daarna uit en test normale lokale login.

## Rollback

```bash
./rollback.sh /opt/fortigate-backup/data/self-backups/release-YYYYMMDDHHMMSS.tar.gz
```

## Verwijderen

```bash
./uninstall.sh
```

Dit verwijdert de systemd services. Applicatiedata blijft bewust staan in `APP_DIR`.

## Health endpoint

```text
GET /api/health
```

Retourneert database- en applicatiestatus voor monitoring.

## GitHub CI

De workflow in `.github/workflows/ci.yml` valideert Prisma en de Next.js productiebuild bij pushes en pull requests naar `main`.
