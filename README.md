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

De updateflow maakt eerst een self-backup, voert daarna `git pull`, `pnpm install`, Prisma migrations, build en service restart uit. Als de updateknop vanuit het portaal geen rechten heeft om systemd te herstarten, rondt `update.sh` de pull/build af en toont hij welke `systemctl` commands je eenmalig als root moet uitvoeren.

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
