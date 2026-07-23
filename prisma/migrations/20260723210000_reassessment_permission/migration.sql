INSERT INTO "AccessPermission" ("id", "key", "category", "description")
VALUES (
  'permission_security_analyses_reassess',
  'security.analyses.reassess',
  'Beveiligingsanalyse',
  'Een voltooide analyse van een opgeslagen backup opnieuw beoordelen'
)
ON CONFLICT ("key") DO UPDATE
SET
  "category" = EXCLUDED."category",
  "description" = EXCLUDED."description";

INSERT INTO "AccessRolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM "AccessRole" AS role
JOIN "Tenant" AS tenant
  ON tenant."id" = role."tenantId"
JOIN "AccessPermission" AS permission
  ON permission."key" = 'security.analyses.reassess'
WHERE tenant."kind" = 'GLOBAL'
  AND role."system" = true
  AND role."name" IN ('Super Admin', 'Tenant Admin')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
