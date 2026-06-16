# FortiGate Backup Portal

Productiegericht MSP-portaal voor centraal beheer van FortiGate configuratiebackups.

## Stack

- Next.js 15 met TypeScript
- Prisma met SQLite en PostgreSQL-ready datasource
- Lokale login met beveiligde sessiecookies
- AES-256-GCM encryptie voor tokens en secrets
- FortiGate REST API backupflow met SHA256-deduplicatie
- SMTP en Microsoft Graph mailproviders via database-instellingen
- Systemd services voor webapp en scheduler-worker

## Installatie

```bash
git clone <repository-url>
cd <repository>/APP
cp .env.example .env
```

Vul alleen deze waarden in `.env`:

```bash
DATABASE_URL="file:../data/app.db"
NEXTAUTH_SECRET="<minimaal 32 tekens>"
ENCRYPTION_KEY="<minimaal 32 tekens>"
```

Productie-installatie op Ubuntu:

```bash
corepack enable
chmod +x setup.sh update.sh rollback.sh uninstall.sh
./setup.sh
```

Open daarna `/setup` en maak de eerste tenant en super-admin aan.

## Update en rollback

```bash
./update.sh
./rollback.sh /opt/fortigate-backup/data/self-backups/release-YYYYMMDDHHMMSS.tar.gz
```

## Health endpoint

`GET /api/health` retourneert database- en applicatiestatus voor monitoring.

## GitHub

De workflow in `.github/workflows/ci.yml` valideert Prisma en de Next.js build bij pushes en pull requests naar `main`.
