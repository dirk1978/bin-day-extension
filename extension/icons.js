// Draws a wheelie bin onto any 2D canvas context, in one or more colours.
// Several bins split the body into vertical stripes, so "Green + Brown" reads
// at 16px. Used for the toolbar icon (OffscreenCanvas in the service worker),
// the popup, and scripts/make-icons.mjs for the static PNGs.

import { BIN_COLOURS } from "./lib.js";

const OUTLINE = "#1f2937";
const EMPTY = "#d1d5db";
const VAN_BODY = "#e5e7eb";
const VAN_CAB = "#f59e0b";
const VAN_WINDOW = "#bfdbfe";

/**
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {number} size  square canvas size in px
 * @param {string[]} bins  e.g. ["Green", "Brown"]; empty draws a pale bin
 */
export function drawBin(ctx, size, bins) {
  const s = size / 32; // everything is laid out on a 32px grid
  const colours = bins.length ? bins.map((b) => BIN_COLOURS[b] || EMPTY) : [EMPTY];
  ctx.clearRect(0, 0, size, size);
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1, 1.5 * s);
  ctx.strokeStyle = OUTLINE;

  // Body: slightly narrower at the bottom, like a real wheelie bin.
  const body = new Path2D();
  body.moveTo(6 * s, 9 * s);
  body.lineTo(26 * s, 9 * s);
  body.lineTo(24 * s, 27 * s);
  body.lineTo(8 * s, 27 * s);
  body.closePath();
  fillStriped(ctx, body, colours, 6 * s, 20 * s, size);
  ctx.stroke(body);

  // Lid, overhanging the body, in the same stripes.
  const lid = new Path2D();
  lid.rect(4 * s, 5 * s, 24 * s, 4 * s);
  fillStriped(ctx, lid, colours, 4 * s, 24 * s, size);
  ctx.stroke(lid);

  // Handle on top of the lid.
  ctx.beginPath();
  ctx.moveTo(12 * s, 5 * s);
  ctx.lineTo(12 * s, 3 * s);
  ctx.lineTo(20 * s, 3 * s);
  ctx.lineTo(20 * s, 5 * s);
  ctx.stroke();

  // Wheels.
  ctx.fillStyle = OUTLINE;
  for (const x of [10, 22]) {
    ctx.beginPath();
    ctx.arc(x * s, 28.5 * s, 2.5 * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * A bin lorry driving off to the right: "the van's been". Same 32px grid and
 * outline as the bin so the two read as one icon set.
 */
export function drawVan(ctx, size) {
  const s = size / 32;
  ctx.clearRect(0, 0, size, size);
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1, 1.5 * s);
  ctx.strokeStyle = OUTLINE;

  // Motion lines behind it (only legible from 32px up).
  if (size >= 32) {
    ctx.beginPath();
    for (const y of [12, 17, 22]) {
      ctx.moveTo(0.5 * s, y * s);
      ctx.lineTo(3.5 * s, y * s);
    }
    ctx.stroke();
  }

  // Refuse body.
  ctx.fillStyle = VAN_BODY;
  ctx.beginPath();
  ctx.rect(5 * s, 8 * s, 16 * s, 16 * s);
  ctx.fill();
  ctx.stroke();

  // Cab, with its window.
  ctx.fillStyle = VAN_CAB;
  ctx.beginPath();
  ctx.moveTo(21 * s, 12 * s);
  ctx.lineTo(27 * s, 12 * s);
  ctx.lineTo(30 * s, 17 * s);
  ctx.lineTo(30 * s, 24 * s);
  ctx.lineTo(21 * s, 24 * s);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = VAN_WINDOW;
  ctx.beginPath();
  ctx.moveTo(23 * s, 14 * s);
  ctx.lineTo(26.5 * s, 14 * s);
  ctx.lineTo(28.5 * s, 17.5 * s);
  ctx.lineTo(23 * s, 17.5 * s);
  ctx.closePath();
  ctx.fill();

  // Wheels.
  ctx.fillStyle = OUTLINE;
  for (const x of [10, 25]) {
    ctx.beginPath();
    ctx.arc(x * s, 26 * s, 3 * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

function fillStriped(ctx, path, colours, x0, width, size) {
  const stripe = width / colours.length;
  colours.forEach((colour, i) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0 + i * stripe, 0, stripe + (i < colours.length - 1 ? 0.5 : 0), size);
    ctx.clip();
    ctx.fillStyle = colour;
    ctx.fill(path);
    ctx.restore();
  });
}

/**
 * ImageData map for chrome.action.setIcon, from inside the service worker.
 * `bins` is a list of colours, or "van" once today's collection is done.
 */
export function iconImageData(bins, sizes = [16, 32, 48]) {
  const out = {};
  for (const size of sizes) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    if (bins === "van") drawVan(ctx, size);
    else drawBin(ctx, size, bins);
    out[size] = ctx.getImageData(0, 0, size, size);
  }
  return out;
}
