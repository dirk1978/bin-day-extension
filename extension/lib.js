// Pure logic for Bin Day: talking to Bromsgrove District Council's bin
// collection site and working out what goes out next. No chrome.* APIs here,
// so it runs unchanged under `node --test`.

export const BASE_URL = "https://bincollections.bromsgrove.gov.uk";

// Bromsgrove's garden waste season, from the council's 2026 leaflet:
// "Brown bin week W/C 2nd Mar - W/E 11th Dec". Re-check each January.
export const GARDEN_SEASON = { start: [3, 2], end: [12, 11] };

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

export function inGardenSeason(isoDay, season = GARDEN_SEASON) {
  const [, m, d] = isoDay.split("-").map(Number);
  const marker = m * 100 + d;
  const start = season.start[0] * 100 + season.start[1];
  const end = season.end[0] * 100 + season.end[1];
  return start <= end ? marker >= start && marker <= end : marker >= start || marker <= end;
}

/**
 * Bins due on a date for this household. `garden` is "none", "Green" or
 * "Grey": the bin the brown one goes out with. The council page never lists
 * the brown bin because it's a paid opt-in, so it's added here.
 */
export function binsFor(schedule, isoDay, garden = "none") {
  const bins = [...(schedule[isoDay] || [])];
  if (
    garden !== "none" &&
    bins.includes(garden) &&
    !bins.includes("Brown") &&
    inGardenSeason(isoDay)
  ) {
    bins.push("Brown");
  }
  return bins;
}

export function upcoming(schedule, today, garden = "none") {
  const from = isoDate(today);
  return Object.keys(schedule)
    .sort()
    .filter((d) => d >= from)
    .map((d) => ({ date: d, bins: binsFor(schedule, d, garden) }));
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
