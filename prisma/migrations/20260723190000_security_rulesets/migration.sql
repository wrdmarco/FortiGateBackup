CREATE TYPE "SecurityRulesetStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "SecurityRuleEvaluator" AS ENUM ('BUILTIN', 'DECLARATIVE');

CREATE TABLE "SecurityRuleset" (
  "id" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "status" "SecurityRulesetStatus" NOT NULL DEFAULT 'DRAFT',
  "changeReason" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" TIMESTAMPTZ(3),
  CONSTRAINT "SecurityRuleset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SecurityRuleset_version_format" CHECK ("version" ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  CONSTRAINT "SecurityRuleset_reason_required" CHECK (length(btrim("changeReason")) BETWEEN 3 AND 500)
);

CREATE TABLE "SecurityRule" (
  "id" TEXT NOT NULL,
  "rulesetId" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "category" TEXT NOT NULL,
  "severity" "SecuritySeverity" NOT NULL,
  "weight" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "explanation" TEXT NOT NULL,
  "remediation" TEXT NOT NULL,
  "positiveTitle" TEXT NOT NULL,
  "evaluator" "SecurityRuleEvaluator" NOT NULL,
  "configPath" TEXT,
  "conditions" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SecurityRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SecurityRule_weight_range" CHECK ("weight" BETWEEN 1 AND 100),
  CONSTRAINT "SecurityRule_rule_id_format" CHECK ("ruleId" ~ '^FG-[A-Z0-9]+-[0-9]{3}$'),
  CONSTRAINT "SecurityRule_text_required" CHECK (
    length(btrim("category")) BETWEEN 2 AND 100 AND
    length(btrim("title")) BETWEEN 3 AND 200 AND
    length(btrim("explanation")) BETWEEN 3 AND 2000 AND
    length(btrim("remediation")) BETWEEN 3 AND 2000 AND
    length(btrim("positiveTitle")) BETWEEN 3 AND 200
  ),
  CONSTRAINT "SecurityRule_declarative_fields" CHECK (
    ("evaluator" = 'BUILTIN' AND "configPath" IS NULL AND "conditions" IS NULL) OR
    ("evaluator" = 'DECLARATIVE' AND "configPath" IN ('system interface','system admin','firewall policy','firewall local-in-policy','firewall address','firewall addrgrp','firewall service custom','firewall service group','vpn ssl settings','vpn ipsec phase1-interface','log setting') AND jsonb_typeof("conditions"::jsonb) = 'array')
  )
);

CREATE UNIQUE INDEX "SecurityRuleset_version_key" ON "SecurityRuleset"("version");
CREATE UNIQUE INDEX "SecurityRuleset_one_active" ON "SecurityRuleset"((status)) WHERE status = 'ACTIVE';
CREATE INDEX "SecurityRuleset_status_createdAt_idx" ON "SecurityRuleset"("status", "createdAt");
CREATE UNIQUE INDEX "SecurityRule_rulesetId_ruleId_key" ON "SecurityRule"("rulesetId", "ruleId");
CREATE INDEX "SecurityRule_rulesetId_enabled_sortOrder_idx" ON "SecurityRule"("rulesetId", "enabled", "sortOrder");
ALTER TABLE "SecurityRule" ADD CONSTRAINT "SecurityRule_rulesetId_fkey" FOREIGN KEY ("rulesetId") REFERENCES "SecurityRuleset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SecurityAnalysisJob" ADD CONSTRAINT "SecurityAnalysisJob_targetRulesetVersion_fkey" FOREIGN KEY ("targetRulesetVersion") REFERENCES "SecurityRuleset"("version") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION fortibackup_protect_published_ruleset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'published rulesets are immutable'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'DRAFT' THEN RETURN NEW; END IF;
  IF OLD.status = 'ACTIVE' AND NEW.status = 'RETIRED'
     AND NEW.version = OLD.version AND NEW."changeReason" = OLD."changeReason"
     AND NEW."createdById" = OLD."createdById" AND NEW."createdAt" = OLD."createdAt"
     AND NEW."publishedAt" = OLD."publishedAt" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'published rulesets are immutable';
END $$;

CREATE TRIGGER "SecurityRuleset_immutable"
BEFORE UPDATE OR DELETE ON "SecurityRuleset"
FOR EACH ROW EXECUTE FUNCTION fortibackup_protect_published_ruleset();

CREATE OR REPLACE FUNCTION fortibackup_protect_published_rule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id text;
DECLARE parent_status "SecurityRulesetStatus";
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."rulesetId" ELSE NEW."rulesetId" END;
  SELECT status INTO parent_status FROM "SecurityRuleset" WHERE id = parent_id;
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'rules in published rulesets are immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "SecurityRule_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "SecurityRule"
FOR EACH ROW EXECUTE FUNCTION fortibackup_protect_published_rule();

INSERT INTO "SecurityRuleset" ("id","version","status","changeReason","createdById","publishedAt")
VALUES ('ruleset_builtin_2_0_0','2.0.0','DRAFT','Geïmporteerde productie-baseline','system',NULL);

INSERT INTO "SecurityRule" ("id","rulesetId","ruleId","category","severity","weight","title","explanation","remediation","positiveTitle","evaluator","sortOrder") VALUES
('rule_fg_pol_001','ruleset_builtin_2_0_0','FG-POL-001','Firewallbeleid','CRITICAL',18,'Any-to-any beleid','Een accepterend beleid is te breed.','Beperk bron, bestemming en service tot wat functioneel nodig is.','Geen volledig any-to-any beleid','BUILTIN',10),
('rule_fg_pol_002','ruleset_builtin_2_0_0','FG-POL-002','Firewallbeleid','HIGH',8,'Bron is all','Het beleid accepteert verkeer vanaf iedere bron.','Gebruik specifieke bronobjecten.','Bronnen zijn specifiek begrensd','BUILTIN',20),
('rule_fg_pol_003','ruleset_builtin_2_0_0','FG-POL-003','Firewallbeleid','HIGH',8,'Bestemming is all','Het beleid accepteert verkeer naar iedere bestemming.','Gebruik specifieke bestemmingsobjecten.','Bestemmingen zijn specifiek begrensd','BUILTIN',30),
('rule_fg_pol_004','ruleset_builtin_2_0_0','FG-POL-004','Firewallbeleid','HIGH',8,'Service is onbeperkt','Het beleid staat alle services toe.','Sta alleen benodigde services toe.','Services zijn specifiek begrensd','BUILTIN',40),
('rule_fg_log_001','ruleset_builtin_2_0_0','FG-LOG-001','Logging','MEDIUM',5,'Logging ontbreekt','Een accepterend beleid logt verkeer niet.','Schakel all-sessions logging in.','Verkeerslogging is actief','BUILTIN',50),
('rule_fg_mgt_001','ruleset_builtin_2_0_0','FG-MGT-001','Beheer','CRITICAL',16,'Telnet-beheer actief','Telnet biedt geen transportversleuteling.','Verwijder telnet uit allowaccess.','Telnet-beheer is uitgeschakeld','BUILTIN',60),
('rule_fg_mgt_002','ruleset_builtin_2_0_0','FG-MGT-002','Beheer','HIGH',10,'HTTP-beheer actief','HTTP-beheer is onbeveiligd.','Gebruik uitsluitend HTTPS voor webbeheer.','HTTP-beheer is uitgeschakeld','BUILTIN',70),
('rule_fg_mgt_003','ruleset_builtin_2_0_0','FG-MGT-003','Beheer','HIGH',10,'Breed beheer op publieke interface','Een publieke interface staat beheerprotocollen toe.','Beperk beheer tot een dedicated managementnetwerk en trusted hosts.','Publieke beheerblootstelling is geblokkeerd','BUILTIN',80),
('rule_fg_utm_001','ruleset_builtin_2_0_0','FG-UTM-001','Security profiles','MEDIUM',6,'Securityprofielen ontbreken','Een accepterend internetbeleid heeft geen zichtbaar securityprofiel.','Activeer passende AV-, IPS- en webfilterprofielen.','Securityprofielen zijn gekoppeld','BUILTIN',90),
('rule_fg_vpn_001','ruleset_builtin_2_0_0','FG-VPN-001','VPN','HIGH',10,'Risicovolle VPN-crypto','De VPN gebruikt een verouderde of zwakke cryptografische instelling.','Gebruik actuele IKE- en sterke encryptie-instellingen.','VPN-cryptografie gebruikt geen herkende zwakke instelling','BUILTIN',100),
('rule_fg_grp_001','ruleset_builtin_2_0_0','FG-GRP-001','Objecten','LOW',3,'Overmatig brede groep','Een objectgroep bevat uitzonderlijk veel leden.','Splits groepen op functionele zone of toepassing.','Objectgroepen blijven binnen de breedtelimiet','BUILTIN',110);

UPDATE "SecurityRuleset" SET status='ACTIVE',"publishedAt"=CURRENT_TIMESTAMP WHERE id='ruleset_builtin_2_0_0';

ALTER TABLE "SecurityRuleset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SecurityRuleset" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SecurityRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SecurityRule" FORCE ROW LEVEL SECURITY;
CREATE POLICY "SecurityRuleset_read" ON "SecurityRuleset" FOR SELECT USING (true);
CREATE POLICY "SecurityRuleset_global_admin_insert" ON "SecurityRuleset" FOR INSERT WITH CHECK (current_setting('app.global_ruleset_admin',true)='1');
CREATE POLICY "SecurityRuleset_global_admin_update" ON "SecurityRuleset" FOR UPDATE USING (current_setting('app.global_ruleset_admin',true)='1') WITH CHECK (current_setting('app.global_ruleset_admin',true)='1');
CREATE POLICY "SecurityRuleset_global_admin_delete" ON "SecurityRuleset" FOR DELETE USING (current_setting('app.global_ruleset_admin',true)='1');
CREATE POLICY "SecurityRule_read" ON "SecurityRule" FOR SELECT USING (true);
CREATE POLICY "SecurityRule_global_admin_insert" ON "SecurityRule" FOR INSERT WITH CHECK (current_setting('app.global_ruleset_admin',true)='1');
CREATE POLICY "SecurityRule_global_admin_update" ON "SecurityRule" FOR UPDATE USING (current_setting('app.global_ruleset_admin',true)='1') WITH CHECK (current_setting('app.global_ruleset_admin',true)='1');
CREATE POLICY "SecurityRule_global_admin_delete" ON "SecurityRule" FOR DELETE USING (current_setting('app.global_ruleset_admin',true)='1');
