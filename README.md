# FortiGate Backup Portal

Productiegericht MSP-portaal voor centraal beheer van FortiGate configuratiebackups.

## Functionaliteit

- Multi-tenant beheer met strikte tenantisolatie
- Eerste tenant via `/setup`
- Nieuwe tenants via het menu `Tenants`, alleen zichtbaar voor `SUPER_ADMIN`
- Per tenant klanten, FortiGates, backups, instellingen en auditlogs
- Lokale login met beveiligde sessiecookies
- FortiGate REST API backupflow met SHA256-deduplicatie
- Firmwarehistorie en audit logging
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

Alle applicatie-instellingen worden in de database beheerd. Alleen deze waarden horen in `.env`:

```bash
DATABASE_URL="file:../data/app.db"
NEXTAUTH_SECRET=""
ENCRYPTION_KEY=""
```

Tijdens `setup.sh` worden lege of ontbrekende waarden voor `NEXTAUTH_SECRET` en `ENCRYPTION_KEY` automatisch veilig gegenereerd. Bestaande waarden worden niet overschreven.

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

## Updates

```bash
./update.sh
```

De updateflow maakt eerst een self-backup, voert daarna `git pull`, `pnpm install`, Prisma migrations, build en service restart uit.

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
