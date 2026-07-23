# FortiGate-beveiligingsrulesets

Rulesets worden uitsluitend in de `GLOBAL`-context beheerd via **Instellingen → Beveiligingsregels**. Alleen gebruikers met `platform.security.rulesets.read` kunnen versies bekijken; publiceren en wijzigen vereist `platform.security.rulesets.manage`.

## Levenscyclus

Een nieuwe versie begint als `DRAFT` en is een volledige kopie van de actieve versie. Alleen een concept kan worden gewijzigd. Publiceren valideert alle regels, trekt de vorige actieve versie in en activeert de nieuwe versie in één serialiseerbare PostgreSQL-transactie. PostgreSQL-triggers blokkeren wijzigingen aan gepubliceerde regels en een partial unique index staat maximaal één actieve ruleset toe.

Bestaande analyses en PDF-rapporten blijven gekoppeld aan hun opgeslagen rulesetversie. Alleen toekomstige analyses en expliciete herbeoordelingen gebruiken de nieuw gepubliceerde versie.

## Veilige declaratieve regels

Een beheerder kan metadata van ingebouwde detectoren aanpassen of een declaratieve regel toevoegen. Declaratieve regels ondersteunen maximaal vijf `AND`-voorwaarden op velden uit de lokale FortiOS-parser:

- `EQUALS`
- `CONTAINS`
- `NOT_CONTAINS`
- `EXISTS`
- `NOT_EXISTS`
- `COUNT_GT`

JavaScript, SQL, shellcode, vrije expressies en uitvoerbare plugins zijn niet toegestaan. Databaseconstraints, Zod-validatie en een vaste evaluator-allowlist bewaken dit formaat.

## Bewijs en Foundry

Online bevindingen en lokale PDF’s noemen het echte FortiGate-object, zoals policy-ID, interface, VPN of objectgroep. Verdachte secretachtige identifiers worden afgeschermd. Deze namen worden nooit opgenomen in het Azure Foundry-payload; Foundry ontvangt uitsluitend tijdelijke tokens zoals `OBJECT_1`.
