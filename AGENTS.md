# AGENTS.md

## Projectregels

Dit project moet volledig productiegeschikt worden gebouwd.

### Basisregels

1. Geen mock data.
2. Geen placeholders.
3. Geen demo code.
4. Geen hardcoded secrets.
5. Geen secrets in GitHub.
6. Geen wachtwoorden in broncode.
7. Geen API-tokens in repository.
8. Geen databasebestanden in GitHub.
9. Geen backupbestanden in GitHub.

### GitHub

`.gitignore` moet minimaal uitsluiten:

- `.env`
- `*.db`
- `backups`
- `logs`
- `uploads`
- `secrets`
- `keys`

### Configuratie

Alles via database, behalve:

- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `ENCRYPTION_KEY`

Niet via `.env`:

- SMTP
- Microsoft Graph
- GitHub instellingen
- Scheduler
- Applicatie instellingen

### Installer

Aanwezig en werkend houden:

- `setup.sh`
- `update.sh`
- `rollback.sh`
- `uninstall.sh`

### Productvereisten

- Multi-tenant
- Responsive
- Dark mode
- Light mode
- Audit logging
- Health checks
- Versioning

### Mail

Ondersteun:

- SMTP
- Microsoft Graph

### Login

Ondersteun:

- Local login
- Microsoft Entra ID SSO

### Deployment

GitHub gebaseerd:

- Installatie via `git clone` en `setup.sh`
- Updates via `update.sh`
- Rollback via `rollback.sh`

### Versiebeheer

Na iedere inhoudelijke code-, configuratie-, security-, documentatie- of deploymentwijziging moet expliciet aan de gebruiker gevraagd worden of de applicatieversie ook geüpdatet moet worden.

Wanneer de gebruiker akkoord geeft, werk dan minimaal de zichtbare applicatieversie en packageversie bij en commit/push die wijziging apart of duidelijk herkenbaar.
