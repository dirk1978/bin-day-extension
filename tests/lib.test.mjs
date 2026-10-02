import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  badgeText,
  brownDates,
  COLLECTED_HOUR,
  collectedAt,
  collectionState,
  daysUntil,
  describe,
  describeRound,
  findAddresses,
  gardenRoundsFor,
  isValidPostcode,
  nextCollection,
  normalisePostcode,
  parseAddresses,
  parseGardenStreets,
  parseSchedule,
  resolveGardenRound,
  upcoming,
  whenLabel,
} from "../extension/lib.js";

const fixture = (name) => readFileSync(new URL(name, import.meta.url), "utf8");

// Live pages for DY9 0LU (the uk_bin_collection project's public test
// property), saved on 1 Oct 2026. Collections there are on Thursdays.
const schedule = parseSchedule(fixture("fixture-schedule.html"));

test("postcodes are normalised and validated", () => {
  assert.equal(normalisePostcode(" b617dn "), "B61 7DN");
  assert.equal(normalisePostcode("dy9  0lu"), "DY9 0LU");
  assert.ok(isValidPostcode("b61 7dn"));
  assert.ok(isValidPostcode("SW1A1AA"));
  assert.ok(!isValidPostcode("hello"));
  assert.ok(!isValidPostcode(""));
});

test("addresses are parsed and sorted by house number", () => {
  const addresses = parseAddresses(fixture("fixture-addresses.html"));
  assert.equal(addresses.length, 47);
  assert.deepEqual(addresses.slice(0, 4).map((a) => a.address), [
    "1 WILLOW CLOSE", "3 WILLOW CLOSE", "4 WILLOW CLOSE", "5 WILLOW CLOSE",
  ]);
  assert.equal(addresses[1].uprn, "100120584653");
  assert.equal(addresses.at(-1).address, "51 WILLOW CLOSE");
});

test("named houses sort after numbered ones", () => {
  const html = '<option value="1">THE OAST</option><option value="2">10 A ROAD</option><option value="3">2 A ROAD</option>';
  assert.deepEqual(parseAddresses(html).map((a) => a.uprn), ["3", "2", "1"]);
});

test("a postcode outside the district yields no addresses", () => {
  assert.deepEqual(parseAddresses(fixture("fixture-no-addresses.html")), []);
});

test("the schedule page is parsed into dates and colours", () => {
  assert.deepEqual(schedule, {
    "2026-10-01": ["Green"],
    "2026-10-08": ["Grey"],
    "2026-10-15": ["Green"],
    "2026-10-22": ["Grey"],
  });
});

// The council's 2026 garden waste street table, saved on 1 Oct 2026.
const gardenRows = parseGardenStreets(fixture("fixture-garden-streets.html"));
const datesOn = (list) => list.map((c) => `${c.date} ${c.bins.join("+")}`);

test("the garden waste street table is parsed, skipping header rows", () => {
  assert.equal(gardenRows.length, 1339);
  assert.ok(gardenRows.every((r) => ["A", "B", "C"].includes(r.calendar)));
  assert.deepEqual(
    gardenRows.find((r) => r.street === "WILLOW CLOSE" && r.locality === "HAGLEY"),
    { street: "WILLOW CLOSE", locality: "HAGLEY", postcodes: ["DY9 0LU"], day: "THURSDAY", calendar: "A" },
  );
});

test("a postcode finds its brown bin round", () => {
  assert.deepEqual(gardenRoundsFor(gardenRows, "dy90lu", "3 WILLOW CLOSE"), [{ day: "THURSDAY", calendar: "A" }]);
  assert.deepEqual(gardenRoundsFor(gardenRows, "SW1A 1AA"), []);
});

test("cells holding several postcodes match each of them", () => {
  // "B61 7FT / B61 7FW" in one cell.
  assert.deepEqual(gardenRoundsFor(gardenRows, "B61 7FW"), [{ day: "THURSDAY", calendar: "B" }]);
  assert.deepEqual(gardenRoundsFor(gardenRows, "B61 7FT"), [{ day: "THURSDAY", calendar: "B" }]);
});

test("a postcode with two rounds returns both to choose from", () => {
  assert.deepEqual(gardenRoundsFor(gardenRows, "B45 9QW"), [
    { day: "WEDNESDAY", calendar: "B" },
    { day: "THURSDAY", calendar: "B" },
  ]);
});

test("calendar weeks match the council's 2026 leaflets", () => {
  const b = brownDates({ calendar: "B", day: "FRIDAY" });
  assert.equal(b[0], "2026-03-06"); // W/C 2 Mar
  assert.equal(b.at(-1), "2026-12-11"); // W/E 11 Dec
  assert.ok(b.includes("2026-10-02"));
  assert.ok(!b.includes("2026-10-09"));

  const a = brownDates({ calendar: "A", day: "MONDAY" });
  assert.equal(a[0], "2026-02-23");
  assert.equal(a.at(-1), "2026-11-30"); // W/E 4 Dec

  const c = brownDates({ calendar: "C", day: "MONDAY" });
  assert.deepEqual([c[0], c.at(-1)], ["2026-02-23", "2026-11-16"]); // W/E 20 Nov
  assert.deepEqual(brownDates({ calendar: "Z", day: "MONDAY" }), []);
});

test("brown is added on the round's weeks", () => {
  const wednesday = new Date(2026, 8, 30);
  assert.deepEqual(datesOn(upcoming(schedule, wednesday, "none")), [
    "2026-10-01 Green", "2026-10-08 Grey", "2026-10-15 Green", "2026-10-22 Grey",
  ]);
  assert.deepEqual(datesOn(upcoming(schedule, wednesday, { calendar: "A", day: "THURSDAY" })), [
    "2026-10-01 Green", "2026-10-08 Grey+Brown", "2026-10-15 Green", "2026-10-22 Grey+Brown",
  ]);
});

test("a brown day that differs from the other bins is its own collection", () => {
  assert.deepEqual(datesOn(upcoming(schedule, new Date(2026, 8, 30), { calendar: "A", day: "TUESDAY" })), [
    "2026-10-01 Green", "2026-10-06 Brown", "2026-10-08 Grey", "2026-10-15 Green", "2026-10-20 Brown", "2026-10-22 Grey",
  ]);
});

test("brown is not added past the council's horizon or the season", () => {
  const late = { "2026-12-10": ["Green"], "2026-12-17": ["Grey"] };
  assert.deepEqual(datesOn(upcoming(late, new Date(2026, 11, 1), { calendar: "B", day: "THURSDAY" })), [
    "2026-12-10 Green+Brown", "2026-12-17 Grey",
  ]);
  assert.deepEqual(datesOn(upcoming({ "2027-03-04": ["Green"] }, new Date(2027, 2, 1), { calendar: "B", day: "THURSDAY" })), [
    "2027-03-04 Green",
  ]);
});

test("v1.0 'with Green/Grey' settings still resolve to a calendar", () => {
  assert.deepEqual(resolveGardenRound(schedule, "Grey"), { calendar: "A", day: "THURSDAY" });
  assert.deepEqual(resolveGardenRound(schedule, "Green"), { calendar: "B", day: "THURSDAY" });
  assert.deepEqual(resolveGardenRound(schedule, { pairWith: "Grey" }), { calendar: "A", day: "THURSDAY" });
  assert.equal(resolveGardenRound(schedule, "none"), null);
  assert.equal(resolveGardenRound(schedule, undefined), null);
});

test("before 9am on collection day the bins are still to go", () => {
  const state = collectionState(schedule, new Date(2026, 9, 1, 8, 59), "Green");
  assert.equal(state.collected, null);
  assert.deepEqual(state.next, { date: "2026-10-01", bins: ["Green", "Brown"] });
});

test("from 9am on collection day the van has been", () => {
  const state = collectionState(schedule, new Date(2026, 9, 1, 9, 0), "Green");
  assert.deepEqual(state.collected, { date: "2026-10-01", bins: ["Green", "Brown"] });
  assert.deepEqual(state.next, { date: "2026-10-08", bins: ["Grey"] });
});

test("the evening before is never 'collected', even after 9", () => {
  assert.equal(collectionState(schedule, new Date(2026, 8, 30, 21, 0)).collected, null);
});

test("the last listed collection, once done, leaves next empty", () => {
  const state = collectionState({ "2026-10-22": ["Grey"] }, new Date(2026, 9, 22, 12, 0));
  assert.deepEqual(state, { collected: { date: "2026-10-22", bins: ["Grey"] }, next: null });
});

test("collectedAt is 9am local on the day", () => {
  assert.equal(collectedAt("2026-10-02").getTime(), new Date(2026, 9, 2, 9, 0, 0).getTime());
  assert.equal(COLLECTED_HOUR, 9);
});

test("rounds are described for the popup", () => {
  assert.equal(describeRound({ calendar: "B", day: "FRIDAY" }), "Fridays, Calendar B (fortnightly, 2 Mar to 11 Dec)");
});

test("the evening before, the next collection is tomorrow's", () => {
  const wednesday = new Date(2026, 8, 30, 20, 0);
  const next = nextCollection(schedule, wednesday, "Green");
  assert.deepEqual(next, { date: "2026-10-01", bins: ["Green", "Brown"] });
  assert.equal(whenLabel(next.date, wednesday), "tomorrow");
  assert.equal(badgeText(next.date, wednesday), "Thu");
});

test("on collection day it stays as today until midnight", () => {
  const thursday = new Date(2026, 9, 1, 23, 30);
  const next = nextCollection(schedule, thursday, "Green");
  assert.equal(next.date, "2026-10-01");
  assert.equal(whenLabel(next.date, thursday), "today");
  assert.equal(badgeText(next.date, thursday), "Now");
});

test("the day after a collection moves on to the next one", () => {
  const friday = new Date(2026, 9, 2, 0, 1);
  assert.deepEqual(nextCollection(schedule, friday, "Green"), { date: "2026-10-08", bins: ["Grey"] });
  assert.equal(whenLabel("2026-10-08", friday), "Thursday");
  assert.equal(upcoming(schedule, friday).length, 3);
});

test("nothing left in the schedule gives null", () => {
  assert.equal(nextCollection(schedule, new Date(2026, 10, 1)), null);
});

test("daysUntil ignores the clock change", () => {
  // UK clocks go back on 25 Oct 2026.
  assert.equal(daysUntil("2026-10-26", new Date(2026, 9, 24, 23, 0)), 2);
});

test("descriptions read naturally", () => {
  assert.equal(describe(["Green"]), "Green bin");
  assert.equal(describe(["Green", "Brown"]), "Green and Brown bins");
  assert.equal(describe(["Green", "Grey", "Brown"]), "Green, Grey and Brown bins");
});

test("findAddresses rejects rubbish before calling the council", async () => {
  let called = false;
  await assert.rejects(findAddresses("nope", async () => { called = true; }), /doesn't look like/);
  assert.equal(called, false);
});

test("findAddresses explains an out-of-district postcode", async () => {
  const fake = async () => ({ ok: true, text: async () => fixture("fixture-no-addresses.html") });
  await assert.rejects(findAddresses("SW1A 1AA", fake), /only works for Bromsgrove/);
});
