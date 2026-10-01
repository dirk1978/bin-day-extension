# Bin Day (Bromsgrove)

A Chrome extension that shows which bins go out next for any address in
Bromsgrove District, and reminds you at 7pm the evening before.

- The toolbar icon is drawn in that week's bin colours: green, grey, or split
  green and brown. A badge shows the day ("Fri"), or "Now" on collection day.
- Click it for the next collection and the weeks after.
- Each person enters their own postcode and picks their address. Nothing leaves
  the browser except requests to the council's own bin collection site.

## Install (for friends and neighbours)

1. Download `bin-day-<version>.zip` from the
   [Releases page](../../releases/latest) and unzip it somewhere permanent.
   Chrome loads it from that folder, so don't leave it in Downloads.
2. In Chrome, go to `chrome://extensions` and switch on **Developer mode**
   (top right).
3. Click **Load unpacked** and choose the unzipped folder (the one with
   `manifest.json` in it).
4. A setup tab opens. Enter your postcode, choose your address, and say whether
   you pay for garden waste and which bin it goes out with.
5. Click the puzzle-piece icon in the toolbar and pin **Bin Day**.

Chrome may sometimes ask whether to keep developer-mode extensions. Keep it.

## How it works

- Addresses come from the council's postcode search at
  `bincollections.bromsgrove.gov.uk`, and the schedule from the same site's
  details page. It's refreshed every 6 hours, and the last good schedule is
  kept if the site is down.
- **Brown bins aren't on the council's site**, because garden waste is a paid
  extra. If you say you have one, it's added on the weeks of the bin you chose,
  during the season (2 March to 11 December, from the council's 2026 leaflet;
  update `GARDEN_SEASON` in `extension/lib.js` each January).
- The reminder only fires while Chrome is running. If Chrome opens later that
  evening, it fires then.

## Development

```bash
npm test                 # unit tests (node --test), no dependencies
npm run package          # dist/bin-day-<version>.zip

# Regenerate the PNG icons, and run the live end-to-end check
# (needs a Playwright install and a Chromium binary).
PLAYWRIGHT=/path/to/node_modules/playwright CHROME=/path/to/chrome node scripts/make-icons.mjs
PLAYWRIGHT=... CHROME=... node scripts/e2e.mjs "DY9 0LU" 3 Green
```

`extension/lib.js` holds all the parsing and date logic and has no `chrome.*`
calls, so it's what the tests cover. `background.js` owns the icon, alarms and
notifications; `popup.js` is setup and display.
