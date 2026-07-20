# Onderhoudsmodus bij update en rollback

Tijdens een update of rollback stopt de Next.js-service voordat dependencies, migraties en de productiebuild worden gewijzigd. De zelfstandige maintenance-server neemt in die periode dezelfde applicatiepoort (`3000`) over. Deze server gebruikt alleen Node.js-core en is niet afhankelijk van `.next` of `node_modules`.

## Servicevolgorde

1. De update- of rollbacklock wordt atomair aangemaakt in `data/logs/update.lock`.
2. `scripts/maintenance-server.mjs` wordt gekopieerd naar `data/update-runtime/maintenance-server.mjs`.
3. De worker en de webservice stoppen.
4. `fortigate-backup-update-maintenance.service` neemt poort `3000` over en `/api/health` wordt gecontroleerd.
5. Installatie, migraties en build worden uitgevoerd.
6. De maintenance-service stopt en de webservice neemt poort `3000` terug over.
7. Pas na een geslaagde applicatie-healthcheck start de worker opnieuw.
8. De eindstatus wordt atomair vastgelegd en de lock wordt verwijderd.

Bij een fout voordat een gezonde webbuild beschikbaar is, blijft de maintenance-service actief. Hierdoor ziet de gebruiker een beheerst onderhoudsscherm in plaats van een langdurige proxy-`502`.

## Gebruikersgedrag

- Alle ingelogde gebruikers ontvangen de onderhoudsstatus via Server-Sent Events met polling als fallback.
- Alleen de gebruiker die de update start, ontvangt de live log. Hiervoor wordt een tijdelijke `HttpOnly` viewer-cookie gebruikt; op schijf staat uitsluitend de SHA-256-hash.
- Iedere browser bewaart zijn eigen laatste veilige applicatiepad in `sessionStorage`.
- Zodra de applicatieservice weer antwoordt, keert de browser automatisch terug naar dat pad.
- Het onderhoudsscherm toont geen interne redirect- of proxyfouten.

## Eenmalige installatie

Voer na installatie van een release die de maintenance-service introduceert eenmalig uit:

```bash
sudo ./setup.sh
```

Dit installeert de systemd-unit en de minimaal benodigde sudoers-regels. Latere portalupdates gebruiken dezelfde geisoleerde serviceflow.

## Controle en herstel

```bash
systemctl status fortigate-backup-update.service
systemctl status fortigate-backup-update-maintenance.service
systemctl status fortigate-backup.service
tail -f /opt/fortigate-backup/data/logs/update.log
```

Wanneer een update faalt en maintenance actief blijft, herstel dan de updatefout of voer een gevalideerde rollback uit. Start de worker pas nadat de webservice en `pnpm run health` slagen.

## Reverse-proxyvoorwaarde

De reverse proxy moet de applicatie zonder padwijziging doorsturen naar poort `3000` en antwoorden van de upstream niet als vaste `502` cachen. Een zeer korte verbindingsherstart kan optreden tijdens de twee poortoverdrachten; de browserpolling herstelt die automatisch.
