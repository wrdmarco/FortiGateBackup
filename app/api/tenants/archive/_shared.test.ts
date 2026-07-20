import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  archivePermission,
  assertGlobalArchiveContext,
  redirectToTenants
} from "./_shared";

test("tenantarchiefacties zijn aan afzonderlijke platformpermissions gekoppeld", () => {
  assert.equal(archivePermission("export"), "platform.tenants.export");
  assert.equal(archivePermission("restore"), "platform.tenants.restore");
  assert.equal(archivePermission("switch"), "platform.tenants.switch");
});

test("een custom Global rol is niet hardcoded afhankelijk van SUPER_ADMIN", () => {
  assert.doesNotThrow(() => {
    assertGlobalArchiveContext(
      { tenantId: "tenant_global", activeTenantId: "tenant_global" },
      "tenant_global"
    );
  });
});

test("tenantarchieven blijven strikt beperkt tot de actieve Global context", () => {
  assert.throws(
    () => assertGlobalArchiveContext(
      { tenantId: "tenant_global", activeTenantId: "tenant_customer" },
      "tenant_global"
    ),
    /alleen beschikbaar vanuit Global/
  );
  assert.throws(
    () => assertGlobalArchiveContext(
      { tenantId: "tenant_customer", activeTenantId: "tenant_global" },
      "tenant_global"
    ),
    /alleen beschikbaar vanuit Global/
  );
});

test("restore redirect gebruikt See Other zodat de upload-POST niet wordt herhaald", () => {
  const response = redirectToTenants(new NextRequest("https://portal.example.test/api/tenants/archive", { method: "POST" }));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "https://portal.example.test/tenants");
});
