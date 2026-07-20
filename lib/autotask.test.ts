import assert from "node:assert/strict";
import test from "node:test";
import type { Backup } from "@prisma/client";
import { buildAutotaskTicketPayload, type AutotaskTicketTarget } from "./autotask";

test("Autotask verstuurt het ingestelde Work Type als billingCodeID", () => {
  const device = {
    hostname: "edge-fw-01",
    managementUrl: "https://firewall.example.com",
    httpsPort: 443,
    serialNumber: "FGT123456",
    customer: {
      name: "Voorbeeld BV",
      autotaskCompanyId: "12001"
    }
  } as AutotaskTicketTarget;
  const backup = {
    id: "backup-1",
    status: "FAILED",
    createdAt: new Date("2026-07-14T08:00:00.000Z"),
    filesize: 0,
    sha256: null,
    error: "Verbinding mislukt"
  } as Backup;

  const payload = buildAutotaskTicketPayload(device, backup, {
    queueId: "5",
    priorityId: "2",
    workTypeId: "73",
    statusId: "1",
    sourceId: "4",
    issueTypeId: "8",
    subIssueTypeId: "9"
  });

  assert.equal(payload.companyID, 12001);
  assert.equal(payload.billingCodeID, 73);
  assert.equal(Object.hasOwn(payload, "workTypeID"), false);
});
