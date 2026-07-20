# FortiGate Backup Portal

Productiegericht MSP-portaal voor centraal beheer van FortiGate configuratiebackups.

## Functionaliteit

- Multi-tenant beheer met strikte tenantisolatie
- Eenmalig beveiligde eerste inrichting via de installer
- Nieuwe tenants via het menu `Tenants` met platformpermissions
- Per tenant klanten, FortiGates, backups, instellingen en auditlogs
- Lokale login en tenantgebonden Microsoft Entra ID SSO met gehashte sessietokens
- FortiGate REST API backupflow met SHA256-deduplicatie
- Firmwarehistorie, audit logging en per-FortiGate backuplogs
- Online FortiOS firmwarecheck tegen Fortinet Document Library release notes
- SMTP en Microsoft Graph mailconfiguratie via database-instellingen
- Health endpoint voor monitoring
- Systemd services voor webapp en scheduler-worker
- GitHub Actions CI voor buildvalidatie

## Stack

- Ubuntu 24.04 LTS of Ubuntu 26.04 LTS
- Node.js 24 LTS
- Next.js 16
- TypeScript
- Prisma
- SQLite
- pnpm
- Tailwind CSS
- node-cron

## Configuratie

Alle applicatie-instellingen worden in de database beheerd. Alleen technische bootstrap- en deploymentwaarden horen in `.env`:

```bash
DATABASE_URL="file:../data/app.db"
NEXTAUTH_SECRET=""
ENCRYPTION_KEY=""
```

Tijdens `setup.sh` worden lege of ontbrekende waarden voor `NEXTAUTH_SECRET` en `ENCRYPTION_KEY` automatisch veilig gegenereerd. Bestaande waarden worden niet overschreven. Verouderde of niet-toegestane sleutels worden uit `.env` verwijderd; applicatieconfiguratie hoort in de database.

Per tenant kan een eigen publieke portal-URL in de database worden ingesteld via `Instellingen` > `Configuratie` > `Portal`. Laat deze leeg om de globale portal-URL uit de database te gebruiken.

## Installatie

```bash
git clone https://github.com/wrdmarco/FortiGateBackup.git
cd FortiGateBackup
chmod +x setup.sh update.sh rollback.sh uninstall.sh
sudo ./setup.sh
```

De installer ondersteunt Ubuntu 24.04 en 26.04 LTS, installeert de vereiste systeempakketten en configureert Node.js 24 LTS met pnpm 10. Een andere Linux-distributie of Node-majorversie wordt geweigerd om verschillen tussen productie en CI te voorkomen.

`setup.sh` installeert de applicatie standaard naar:

```bash
/opt/fortigate-backup
```

Je kunt dit aanpassen met:

```bash
sudo APP_DIR=/opt/mijn-pad ./setup.sh
```

`setup.sh` kan veilig opnieuw worden uitgevoerd. Synchronisatie met `--delete` sluit `.env`, databases en alle mappen voor data, backups, uploads, logs, secrets en keys uit. De systemd-units worden voor de gekozen `APP_DIR` gerenderd; er staat geen vast applicatiepad in de templates.

De gerenderde units blijven bewust root-owned onder `/etc/systemd/system`. Voer `setup.sh` opnieuw als root uit wanneer bestanden onder `systemd/` wijzigen; het applicatieserviceaccount kan unitdefinities niet aanpassen.

Aan het einde maakt `setup.sh` een eenmalige, 30 minuten geldige setup-link. Open het afgedrukte pad op de publieke portalhost. Een nieuw pad kan zolang setup nog niet is voltooid worden gemaakt met:

```bash
cd /opt/fortigate-backup
pnpm setup:link -- --base-url=https://portal.example.nl
```

De setup maakt altijd precies één `Global` platformtenant en de eerste Super Admin aan. `/setup` zonder geldige token toont geen aanmaakformulier.

## Tenantbeheer

Na de eerste setup beheren gebruikers met de vereiste platformpermission tenants via:

```text
/tenants
```

Bij het aanmaken van een tenant maak je direct de eerste tenantadmin aan. Die gebruiker krijgt rol `ADMIN` en kan uitsluitend data binnen zijn eigen tenant beheren. Directe API-calls en server actions controleren dezelfde tenantgrenzen.

### Tenantarchief en restore

Een Global beheerder kan een klanttenant als installatiegebonden ZIP exporteren en later dezelfde of een ontbrekende klanttenant herstellen. Het archief bevat tenantinstellingen, klanten, FortiGates, configbestanden, gebruikers, lokale passwordhashes, rollen, roltoewijzingen en tenant-auditregels. Sessies, OAuth-accounts en tokens worden nooit geëxporteerd.

Elk manifest is met `HMAC-SHA256` en `ENCRYPTION_KEY` ondertekend. Restore weigert gewijzigde archieven en archieven uit een installatie met een andere encryptiesleutel. Bewaar daarom zowel het archief als de bijbehorende encryptiesleutel volgens het eigen recoverybeleid. `Global` kan niet via tenantrestore worden aangemaakt of overschreven.

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

De update wordt uitgevoerd door de afzonderlijke oneshot-service `fortigate-backup-update.service`. Na de Git-controle stopt deze eerst worker en web, maakt een afgeschermde self-backup en voert daarna `git pull`, dependency-installatie, Prisma migrations en de productiebuild uit. Web wordt pas beschikbaar gemaakt na een geslaagde build; de worker start pas nadat de healthcheck is geslaagd. Een update meldt alleen succes wanneer beide services aantoonbaar actief zijn.

`update.sh` houdt tijdens langlopende stappen de update-lock actueel. Wanneer het script zelf door `git pull` wijzigt, hervat de nieuwe versie direct in de post-pullfase en worden installatie, migratie, build en herstart niet overgeslagen.

Tijdens een update krijgen ingelogde gebruikers direct een onderhoudsscherm. De gebruiker die de update start ziet de live log; andere gebruikers zien alleen dat de interface tijdelijk geblokkeerd is.

Als Next.js kort niet bereikbaar is tijdens een restart, kan alleen de reverse proxy een nette pagina tonen. Gebruik bij Nginx de voorbeeldconfiguratie in `deployment/nginx-maintenance.conf.example`. Die toont `public/maintenance.html` bij 502, 503 en 504 in plaats van een kale proxyfout.

Een bestaande installatie van voor de geïsoleerde update-service moet eenmalig opnieuw door de databehoudende installer worden geleid:

```bash
cd /opt/fortigate-backup
sudo APP_DIR=/opt/fortigate-backup ./setup.sh
```

De installer plaatst een met `visudo` gevalideerde, beperkte sudoers-regel voor alleen de benodigde serviceacties.

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

Als de globale portal-URL niet goed staat, geef de publieke URL expliciet mee:

```bash
pnpm break-glass:settings -- --base-url=https://portal.example.nl
```

Eigenschappen van deze link:

- geldig voor 15 minuten
- eenmalig bruikbaar
- token wordt alleen gehasht in de database opgeslagen
- token staat na het openen alleen in het browserfragment en komt daardoor niet in normale webserver- of proxylogs
- sessie is beperkt tot Global SSO-instellingen
- alle andere pagina's worden teruggestuurd naar `/settings?tab=sso`

Na gebruik zet je SSO uit via:

```text
Instellingen > SSO > Microsoft Entra ID SSO
```

Log daarna uit en test normale lokale login.

## Rollback

```bash
sudo ./rollback.sh /opt/fortigate-backup/data/self-backups/release-YYYYMMDDHHMMSS.tar.gz
```

Rollback accepteert alleen door de updateflow gemaakte release-archieven uit `data/self-backups`, controleert de archivepaden en behoudt `.env`, backups, logs, uploads, secrets en keys. Web en worker blijven tijdens databaseherstel, installatie en build gestopt en worden in dezelfde volgorde als bij een update geverifieerd.

## Verwijderen

```bash
sudo ./uninstall.sh
```

Dit verwijdert de systemd services. Applicatiedata blijft bewust staan in `APP_DIR`.

## Health endpoint

```text
GET /api/health
```

Retourneert database- en applicatiestatus voor monitoring.

De CLI-healthcheck ondersteunt een initiële wachttijd, retries, vertraging en een timeout zonder extra `.env`-sleutels:

```bash
pnpm run health -- \
  --initial-delay-ms=5000 \
  --retries=30 \
  --retry-delay-ms=2000 \
  --timeout-ms=5000
```

## GitHub CI

De workflow in `.github/workflows/ci.yml` valideert Prisma en de Next.js productiebuild bij pushes en pull requests naar `main`.
