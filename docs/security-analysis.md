# FortiGate-configuratieanalyse

De analyse ondersteunt uitsluitend aantoonbare FortiOS-configuraties uit immutable FortiBackup-artifacts. Handmatige uploads en multivendorconfiguraties worden niet ondersteund.

Een gewijzigde backup wordt opgeslagen als `data/backups/<tenantId>/<fortigateId>/<sha256>/configuration.conf`. De databaseconstraint op tenant, FortiGate en SHA-256 maakt dit canoniek. Een `UNCHANGED` event verwijst naar het bestaande artifact en maakt geen analysejob. Wanneer een oude hash terugkeert, worden analyse, score en PDF hergebruikt.

Nieuwe analyse wordt alleen aangemaakt wanneer de actieve klanttenant een complete, ingeschakelde Azure AI Foundry-configuratie heeft. De `GLOBAL`-tenant kan database-technisch en in de service/UI geen Foundry-config opslaan. API-keys gebruiken AES-256-GCM met tenantgebonden AAD en worden alleen vlak voor de netwerkcall ontsleuteld.

De lokale pipeline is:

1. hash en immutable pad controleren;
2. begrensde FortiOS-parser uitvoeren;
3. deterministische lokale ruleset en score uitvoeren;
4. uitsluitend een getypeerde allowlistpayload tokeniseren;
5. onafhankelijke residual-secret-scan uitvoeren;
6. Foundry Responses API v1 aanroepen zonder tools, opslag of redirects;
7. output strikt valideren en opnieuw scannen;
8. findings en score opslaan en lokaal een immutable PDF genereren.

Naar Azure gaan alleen FortiOS-versie, lokale rule-ID, severity, penalty, tijdelijke objecttokens, veilige booleans en tellingen. Configuratie, bestandspad, tenant/klantnaam, hostname, serienummer, management-URL, usernames, comments, IP-adressen, passwords, hashes, ENC-waarden, PSK's, keys, certificaten, tokens en communities blijven lokaal.

De technische score wordt lokaal berekend en kan niet door Foundry worden gewijzigd. Dispositions zijn afzonderlijke mutable records en wijzigen finding, severity, score of PDF nooit.

Tenantisolatie bestaat uit actieve tenantcontext, RBAC, verplichte filters, samengestelde foreign keys/guards en PostgreSQL RLS met transactionele `SET LOCAL app.tenant_id`. De runtimegebruiker heeft geen `BYPASSRLS`.
