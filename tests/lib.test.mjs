import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  badgeText,
  binsFor,
  daysUntil,
  describe,
  findAddresses,
  inGardenSeason,
  isValidPostcode,
  nextCollection,
  normalisePostcode,
  parseAddresses,
  parseSchedule,
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

test("garden season runs 2 March to 11 December inclusive", () => {
  assert.ok(!inGardenSeason("2026-03-01"));
  assert.ok(inGardenSeason("2026-03-02"));
  assert.ok(inGardenSeason("2026-12-11"));
  assert.ok(!inGardenSeason("2026-12-12"));
  assert.ok(!inGardenSeason("2027-01-15"));
});

test("brown is added to whichever bin the household chose", () => {
  assert.deepEqual(binsFor(schedule, "2026-10-01", "none"), ["Green"]);
  assert.deepEqual(binsFor(schedule, "2026-10-01", "Green"), ["Green", "Brown"]);
  assert.deepEqual(binsFor(schedule, "2026-10-08", "Green"), ["Grey"]);
  assert.deepEqual(binsFor(schedule, "2026-10-08", "Grey"), ["Grey", "Brown"]);
});

test("brown is not added out of season or twice", () => {
  assert.deepEqual(binsFor({ "2026-12-18": ["Green"] }, "2026-12-18", "Green"), ["Green"]);
  assert.deepEqual(binsFor({ "2026-10-02": ["Brown", "Green"] }, "2026-10-02", "Green"), ["Brown", "Green"]);
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
