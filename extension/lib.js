// Pure logic for Bin Day: talking to Bromsgrove District Council's bin
// collection site and working out what goes out next. No chrome.* APIs here,
// so it runs unchanged under `node --test`.

export const BASE_URL = "https://bincollections.bromsgrove.gov.uk";

// The council's per-street garden waste (brown bin) table: street, locality,
// postcode, collection day and calendar. Republished each year.
export const GARDEN_STREETS_URL =
  "https://www.bromsgrove.gov.uk/residents/my-place/bins-and-recycling/garden-waste-service/garden-waste-collection-dates-2026/";

// Brown bin weeks from the council's 2026 leaflets: fortnightly, from the
// week commencing `first` to the week commencing `last` (both Mondays).
// A and C share weeks; C is Redditch's calendar for 3 border streets and
// stops earlier. Update these, and GARDEN_STREETS_URL, each January.
export const GARDEN_CALENDARS = {
  A: { first: "2026-02-23", last: "2026-11-30", label: "fortnightly, 23 Feb to 4 Dec" },
  B: { first: "2026-03-02", last: "2026-12-07", label: "fortnightly, 2 Mar to 11 Dec" },
  C: { first: "2026-02-23", last: "2026-11-16", label: "fortnightly, 23 Feb to 20 Nov" },
};

const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

export const BIN_COLOURS = {
  Green: "#2e8b3d",
  Grey: "#6b7280",
  Brown: "#8b5a2b",
};

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const DATE_RE =
  /\b(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/g;

/** 'dy90lu' -> 'DY9 0LU'. */
export function normalisePostcode(postcode) {
  const compact = String(postcode || "").replace(/\s+/g, "").toUpperCase();
  return compact.length < 5 ? compact : `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

export function isValidPostcode(postcode) {
  return /^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/.test(normalisePostcode(postcode));
}

/** Parse the council's postcode search page into [{uprn, address}]. */
export function parseAddresses(html) {
  const out = [];
  for (const m of html.matchAll(/<option[^>]*value="(\d+)"[^>]*>([^<]+)/gi)) {
    out.push({ uprn: m[1], address: decodeEntities(m[2]).replace(/\s+/g, " ").trim() });
  }
  // The council sorts as strings, so "10" comes before "3". Sort by number.
  return out.sort((a, b) => {
    const na = parseInt(a.address, 10);
    const nb = parseInt(b.address, 10);
    if (isNaN(na) !== isNaN(nb)) return isNaN(na) ? 1 : -1;
    if (!isNaN(na) && na !== nb) return na - nb;
    return a.address.localeCompare(b.address);
  });
}

/** Parse the details page into {"YYYY-MM-DD": ["Green", ...]}. */
export function parseSchedule(html) {
  const schedule = {};
  for (const block of html.split('class="collection-container"').slice(1)) {
    const heading = block.match(/class="heading">\s*([^<]+?)\s*</);
    if (!heading) continue;
    const colour = heading[1].replace(/\s+bin$/i, "").trim();
    for (const m of block.matchAll(DATE_RE)) {
      const month = MONTHS.indexOf(m[2].toLowerCase());
      if (month < 0) continue;
      const key = isoDate(new Date(+m[3], month, +m[1]));
      schedule[key] = [...new Set([...(schedule[key] || []), colour])].sort();
    }
  }
  return schedule;
}

/**
 * Parse the council's garden waste street table into
 * [{street, locality, postcodes: [...], day: "FRIDAY", calendar: "B"}].
 * Some cells hold several postcodes ("B61 7FT / B61 7FW"); header rows repeat
 * down the page and are skipped.
 */
export function parseGardenStreets(html) {
  const rows = [];
  const cell = "<td[^>]*>([^<]*)</td>\\s*";
  const rowRe = new RegExp(`<tr[^>]*>\\s*${cell.repeat(5)}</tr>`, "gi");
  for (const m of html.matchAll(rowRe)) {
    const [street, locality, postcodeCell, day, calendarCell] = m
      .slice(1)
      .map((v) => decodeEntities(v).replace(/[\s ]+/g, " ").trim());
    const calendar = calendarCell.match(/^Calendar ([A-Z])$/i)?.[1]?.toUpperCase();
    const weekday = day.toUpperCase();
    if (!calendar || !WEEKDAYS.includes(weekday)) continue; // header rows
    const postcodes = [...postcodeCell.toUpperCase().matchAll(/[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}/g)]
      .map((p) => normalisePostcode(p[0]));
    rows.push({ street, locality, postcodes, day: weekday, calendar });
  }
  return rows;
}

/**
 * The garden waste rounds the council lists for a postcode, de-duplicated by
 * day and calendar. Usually one; a few postcodes have two.
 */
export function gardenRoundsFor(rows, postcode, address = "") {
  const pc = normalisePostcode(postcode);
  let matches = rows.filter((r) => r.postcodes.includes(pc));
  // Prefer rows whose street is in the address, when that narrows it down.
  const upper = address.toUpperCase();
  const byStreet = matches.filter((r) => upper.includes(r.street.toUpperCase()));
  if (byStreet.length) matches = byStreet;
  const seen = new Map();
  for (const r of matches) {
    seen.set(`${r.day}|${r.calendar}`, { day: r.day, calendar: r.calendar });
  }
  return [...seen.values()];
}

/** Brown bin dates for a round {day, calendar}, as ISO dates. */
export function brownDates(round) {
  const cal = GARDEN_CALENDARS[round?.calendar];
  const offset = WEEKDAYS.indexOf(round?.day) - 1; // days after Monday
  if (!cal || offset < 0 || offset > 5) return [];
  const out = [];
  const monday = parseIso(cal.first);
  while (isoDate(monday) <= cal.last) {
    const day = new Date(monday);
    day.setDate(day.getDate() + offset);
    out.push(isoDate(day));
    monday.setDate(monday.getDate() + 14);
  }
  return out;
}

/**
 * Work out the household's brown bin round from their saved setting:
 *   "none" or missing                 -> null
 *   {calendar, day}                   -> from the council's street table
 *   {pairWith: "Green"}, or "Green"   -> fallback (and v1.0 settings): the
 *     calendar whose weeks contain that bin's collections, on that bin's day
 */
export function resolveGardenRound(schedule, garden) {
  if (!garden || garden === "none") return null;
  if (garden.calendar && garden.day) return { calendar: garden.calendar, day: garden.day };
  const pairWith = typeof garden === "string" ? garden : garden.pairWith;
  const dates = Object.keys(schedule).filter((d) => schedule[d].includes(pairWith));
  if (!dates.length) return null;
  const day = WEEKDAYS[parseIso(dates[0]).getDay()];
  for (const calendar of ["B", "A"]) {
    const weeks = new Set(brownDates({ calendar, day }));
    if (dates.some((d) => weeks.has(d))) return { calendar, day };
  }
  return null;
}

/**
 * The schedule with the brown bin merged in. The council's bin page never
 * lists it (it's a paid extra), and it can be on a different day from the
 * other bins. Brown dates are only added up to the last date the council page
 * covers, so the list doesn't run on with brown-only weeks.
 */
export function withGarden(schedule, round) {
  const days = Object.keys(schedule).sort();
  if (!round || !days.length) return schedule;
  const merged = Object.fromEntries(Object.entries(schedule).map(([d, b]) => [d, [...b]]));
  for (const d of brownDates(round)) {
    if (d > days.at(-1)) break;
    const bins = (merged[d] ||= []);
    if (!bins.includes("Brown")) bins.push("Brown");
  }
  return merged;
}

/** Collections on or after `today`, with the household's brown bin added. */
export function upcoming(schedule, today, garden = "none") {
  const from = isoDate(today);
  const merged = withGarden(schedule, resolveGardenRound(schedule, garden));
  return Object.keys(merged)
    .sort()
    .filter((d) => d >= from)
    .map((d) => ({ date: d, bins: merged[d] }));
}

/** "Fridays, Calendar B (fortnightly, 2 Mar to 11 Dec)". */
export function describeRound(round) {
  if (!round) return "";
  const day = round.day.charAt(0) + round.day.slice(1).toLowerCase();
  const label = GARDEN_CALENDARS[round.calendar]?.label || "dates unknown";
  return `${day}s, Calendar ${round.calendar} (${label})`;
}

/** The first collection on or after `today` (a Date), or null. */
export function nextCollection(schedule, today, garden = "none") {
  return upcoming(schedule, today, garden)[0] || null;
}

/** Whole days from `today` to an ISO date: 0 = today, 1 = tomorrow. */
export function daysUntil(isoDay, today) {
  const [y, m, d] = isoDay.split("-").map(Number);
  const a = Date.UTC(y, m - 1, d);
  const b = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((a - b) / 86400000);
}

/** ['Green', 'Brown'] -> 'Green and Brown bins'. */
export function describe(bins) {
  if (!bins.length) return "no bins";
  if (bins.length === 1) return `${bins[0]} bin`;
  return `${bins.slice(0, -1).join(", ")} and ${bins.at(-1)} bins`;
}

export function whenLabel(isoDay, today) {
  const days = daysUntil(isoDay, today);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return parseIso(isoDay).toLocaleDateString("en-GB", { weekday: "long" });
}

export function badgeText(isoDay, today) {
  if (daysUntil(isoDay, today) === 0) return "Now";
  return parseIso(isoDay).toLocaleDateString("en-GB", { weekday: "short" });
}

export function parseIso(isoDay) {
  const [y, m, d] = isoDay.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function isoDate(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function decodeEntities(text) {
  return text
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// ---- Network: thin wrappers so the parsing above stays testable. ----

export async function findAddresses(postcode, fetchImpl = fetch) {
  const pc = normalisePostcode(postcode);
  if (!isValidPostcode(pc)) throw new Error(`"${postcode}" doesn't look like a UK postcode.`);
  const res = await fetchImpl(`${BASE_URL}/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ PostCode: pc }),
  });
  if (!res.ok) throw new Error(`The council site returned ${res.status}.`);
  const addresses = parseAddresses(await res.text());
  if (!addresses.length) {
    throw new Error(`No addresses found for ${pc}. This only works for Bromsgrove District postcodes.`);
  }
  return addresses;
}

export async function fetchGardenStreets(fetchImpl = fetch) {
  const res = await fetchImpl(GARDEN_STREETS_URL);
  if (!res.ok) throw new Error(`The council site returned ${res.status}.`);
  const rows = parseGardenStreets(await res.text());
  if (!rows.length) throw new Error("Couldn't read the council's garden waste street list.");
  return rows;
}

export async function fetchSchedule(uprn, fetchImpl = fetch) {
  const res = await fetchImpl(
    `${BASE_URL}/BinCollections/Details?uprn=${encodeURIComponent(uprn)}`,
  );
  if (!res.ok) throw new Error(`The council site returned ${res.status}.`);
  const schedule = parseSchedule(await res.text());
  if (!Object.keys(schedule).length) {
    throw new Error("No collection dates found. The council page may have changed.");
  }
  return schedule;
}
