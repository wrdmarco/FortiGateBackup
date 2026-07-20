import assert from "node:assert/strict";
import test from "node:test";
import { nextCronOccurrence, nextZonedCalendarOccurrence } from "./cron-schedule";

test("berekent stappen en werkdagbereiken", () => {
  const from = new Date("2026-07-13T09:07:45.000Z");
  assert.deepEqual(nextCronOccurrence("*/15 9-17 * * 1-5", from, "UTC"), new Date("2026-07-13T09:15:00.000Z"));
});

test("ondersteunt maand- en weekdagnamen", () => {
  const from = new Date("2026-01-01T00:00:00.000Z");
  assert.deepEqual(nextCronOccurrence("30 8 1 feb sun", from, "UTC"), new Date("2026-02-01T08:30:00.000Z"));
});

test("accepteert zondag als zeven", () => {
  const from = new Date("2026-07-13T00:00:00.000Z");
  assert.deepEqual(nextCronOccurrence("0 7 * * 7", from, "UTC"), new Date("2026-07-19T07:00:00.000Z"));
});

test("weigert cronexpressies met seconden", () => {
  assert.throws(() => nextCronOccurrence("0 */5 * * * *"), /vijf velden/i);
});

test("accepteert witruimte rond een cronexpressie", () => {
  const from = new Date("2026-07-13T09:00:00.000Z");
  assert.deepEqual(nextCronOccurrence("  5 9 * * *  ", from, "UTC"), new Date("2026-07-13T09:05:00.000Z"));
});

test("respecteert schrikkeldagen en maandgrenzen", () => {
  const from = new Date("2027-03-01T00:00:00.000Z");
  assert.deepEqual(nextCronOccurrence("0 6 29 feb *", from, "UTC"), new Date("2028-02-29T06:00:00.000Z"));
});

test("weigert ongeldige datums, bereiken en stappen", () => {
  assert.throws(() => nextCronOccurrence("*/0 * * * *"), /ongeldig/i);
  assert.throws(() => nextCronOccurrence("0 24 * * *"), /ongeldig|bereik/i);
  assert.throws(() => nextCronOccurrence("0 8 1 * *", new Date("invalid")), /begindatum/i);
});

test("cron slaat een niet-bestaande tenanttijd tijdens de DST-start over", () => {
  const from = new Date("2026-03-28T02:00:00.000Z");
  assert.deepEqual(
    nextCronOccurrence("30 2 * * *", from, "Europe/Amsterdam"),
    new Date("2026-03-30T00:30:00.000Z")
  );
});

test("cron onderscheidt beide instanties van een herhaalde tenanttijd", () => {
  const firstOccurrence = new Date("2026-10-25T00:30:00.000Z");
  assert.deepEqual(
    nextCronOccurrence("30 2 * * *", firstOccurrence, "Europe/Amsterdam"),
    new Date("2026-10-25T01:30:00.000Z")
  );
});

test("dagelijkse schema's behouden tenant-wandtijd en handelen DST-gaten af", () => {
  assert.deepEqual(
    nextZonedCalendarOccurrence(
      new Date("2026-03-28T01:30:00.000Z"),
      "daily",
      "Europe/Amsterdam"
    ),
    new Date("2026-03-29T01:00:00.000Z")
  );
  assert.deepEqual(
    nextZonedCalendarOccurrence(
      new Date("2026-10-24T00:30:00.000Z"),
      "daily",
      "Europe/Amsterdam"
    ),
    new Date("2026-10-25T00:30:00.000Z")
  );
});

test("dezelfde cronexpressie volgt de ingestelde tenanttijdzone", () => {
  const from = new Date("2026-07-14T00:00:00.000Z");
  assert.deepEqual(nextCronOccurrence("0 9 * * *", from, "Europe/Amsterdam"), new Date("2026-07-14T07:00:00.000Z"));
  assert.deepEqual(nextCronOccurrence("0 9 * * *", from, "America/New_York"), new Date("2026-07-14T13:00:00.000Z"));
  assert.throws(() => nextCronOccurrence("0 9 * * *", from, "Europe/Invalid"), /tijdzone/i);
});
