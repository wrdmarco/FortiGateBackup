import assert from "node:assert/strict";
import test from "node:test";
import { isInternalPageNavigation } from "@/lib/navigation-intent";

const currentHref = "https://fortibackup.example/customers/tenant";

test("herkent interne App Router-navigatie", () => {
  assert.equal(isInternalPageNavigation({ href: "/security", currentHref }), true);
  assert.equal(isInternalPageNavigation({ href: "?page=2", currentHref }), true);
});

test("toont geen paginalader voor downloads, API-routes of externe links", () => {
  assert.equal(isInternalPageNavigation({ href: "/api/security/reports/report-1", currentHref }), false);
  assert.equal(isInternalPageNavigation({ href: "/rapport.pdf", currentHref }), false);
  assert.equal(isInternalPageNavigation({ href: "/security", currentHref, download: true }), false);
  assert.equal(isInternalPageNavigation({ href: "https://example.org", currentHref }), false);
  assert.equal(isInternalPageNavigation({ href: "/security", currentHref, target: "_blank" }), false);
});
