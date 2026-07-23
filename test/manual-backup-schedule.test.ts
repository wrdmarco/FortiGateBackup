import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("handmatig schema wordt nooit door de scheduler geselecteerd",async()=>{
  const scheduler=await readFile("lib/scheduler.ts","utf8");
  assert.match(scheduler,/scheduleType: \{ not: ScheduleType\.MANUAL \}/);
  assert.ok((scheduler.match(/scheduleType:\s*\{\s*not:\s*ScheduleType\.MANUAL\s*\}/g)??[]).length>=3);
  assert.match(scheduler,/scheduleType:ScheduleType\.MANUAL\},data:\{nextRunAt:null\}/);
});

test("wizard en bewerkpagina bieden Alleen handmatig en validatie accepteert MANUAL",async()=>{
  const [wizard,edit,validators]=await Promise.all([
    readFile("components/fortigate-wizard.tsx","utf8"),
    readFile("app/customers/[id]/fortigates/[fortigateId]/edit/page.tsx","utf8"),
    readFile("lib/validators.ts","utf8")
  ]);
  assert.match(wizard,/<option value="MANUAL">Alleen handmatig<\/option>/);
  assert.match(edit,/<option value="MANUAL">Alleen handmatig<\/option>/);
  assert.match(validators,/\["MANUAL", "HOURLY"/);
});
