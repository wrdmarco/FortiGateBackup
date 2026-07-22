# PostgreSQL-installatie en legacyconversie

FortiBackup gebruikt in productie, development, CI en integratietests uitsluitend PostgreSQL 16 of nieuwer. SQLite is alleen nog een bevroren invoerformaat voor bestaande installaties. De oude migraties en het oude schema staan ongewijzigd onder `prisma/legacy-sqlite/` en worden nooit op PostgreSQL uitgevoerd.

## Nieuwe installatie

`sudo ./setup.sh` installeert PostgreSQL-server en client, maakt database `fortibackup` en genereert afzonderlijke willekeurige credentials voor:

- `fortibackup_migrator`: eigenaar van schema en migraties, zonder superuser-, rolebeheer- of BYPASSRLS-rechten;
- `fortibackup_app`: runtimegebruiker met alleen connect-, usage- en DML-rechten, zonder DDL- of BYPASSRLS-rechten.

De credentials staan root-owned in `/etc/fortigate-backup/postgres.env`, zijn niet zichtbaar in terminaloutput en worden niet in Git opgeslagen. De applicatie-`.env` bevat de runtime-URL. Voor een externe database moeten `EXTERNAL_DATABASE_URL` en `EXTERNAL_MIGRATION_URL` vooraf worden opgegeven; beide moeten een PostgreSQL-URL zijn en de runtime-URL moet `sslmode=verify-full` gebruiken. De installer verwijdert of wijzigt nooit een externe database buiten de FortiBackup-migraties.

De runtime-applicatierol heeft altijd `NOBYPASSRLS`. De afzonderlijke migratorrol heeft `BYPASSRLS` nodig om vóór schemawijzigingen een volledige `pg_dump -Fc` van de geforceerd-RLS-beveiligde tabellen te maken. Deze rol is geen superuser en krijgt geen role- of databasebeheerrechten. Bij een externe database moet de beheerder deze eigenschap vooraf aan de opgegeven migratorrol toekennen.

## Eenmalige voorbereiding bestaande installaties

De beperkte web-updater mag geen packages installeren en geen PostgreSQL-rollen maken. Voer daarom vóór de eerste PostgreSQL-update uit:

```bash
cd /opt/fortigate-backup
sudo ./setup.sh --prepare-postgres-migration
```

Deze opdracht installeert en provisionert alleen PostgreSQL en schrijft de afgeschermde databasecredentials. Applicatiedata wordt pas door de normale update geconverteerd. Ontbreekt de voorbereiding, dan stopt de updater vóór fetch, servicestop of andere mutatie en toont hij bovenstaande opdracht.

## Conversiefasen

De update stopt web en worker en laat alleen de database-onafhankelijke maintenancepagina draaien. `scripts/migrate-sqlite-to-postgres.ts` gebruikt de SQLite backup-API en houdt `data/postgres-migration-state.json` atomisch bij met:

`PREFLIGHT`, `SNAPSHOTTED`, `PG_PROVISIONED`, `SCHEMA_CREATED`, `DATA_COPIED`, `FILES_COPIED`, `VERIFIED`, `CUTOVER`, `HEALTH_VERIFIED`, `COMPLETE`.

De status is gebonden aan installatie-ID, bronhash, brongrootte, doel-database-ID en migratieversie. Hervatting wordt geweigerd wanneer een van deze identiteiten afwijkt. De import gebruikt geen blinde record-upserts. `_prisma_migrations` uit SQLite wordt niet gekopieerd.

De recoverymap onder `data/recovery/` bevat met beperkende rechten de consistente snapshot, oude `.env`, bronmanifest en hashes. Deze map wordt nooit automatisch verwijderd.

## Validatie en cutover

Voor cutover worden SQLite integrity en foreign keys, globale duplicaten, rijenaantallen, primaire-sleuteldigests en configuratiebestanden gecontroleerd. Configuratiebestanden worden read-only geopend, uitsluitend met exclusive-create gekopieerd en voor en na kopiëren gehasht. De bron wordt niet verwijderd of overschreven.

Pas na validatie wordt alleen `DATABASE_URL` atomisch in `.env` vervangen. `NEXTAUTH_SECRET` en `ENCRYPTION_KEY` blijven ongewijzigd. Web start vóór de worker. Na succesvolle conversie is SQLite alleen read-only recoverydata; applicatierollback naar een SQLite-release is niet toegestaan.

Voor iedere latere PostgreSQL-migratie maakt `update.sh` een custom-format dump, SHA-256 en een succesvolle `pg_restore --list`-controle.

## Herstel

Bij een fout vóór cutover blijft de oude `.env` actief. Start de oude release en SQLite-services opnieuw nadat de fout is verholpen. Bij een fout na cutover maar vóór healthvalidatie: herstel de `.env` uit de recoverymap en zet de mislukte PostgreSQL-database in quarantaine; verwijder deze niet automatisch. Na succesvolle cutover gebruikt applicatierollback alleen PostgreSQL-compatibele releases. Databaseherstel gebeurt afzonderlijk met de gecontroleerde `pg_dump -Fc`-bestanden.
