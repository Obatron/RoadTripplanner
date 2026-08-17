# Trip planner

A single-file, dependency-light road-trip planner. Plan a drive between any two
places, add overnight stops, work the schedule backwards from a ferry sailing,
and see the whole thing as a calendar, a route list and a budget.

## What it does

- **Nothing is hardcoded.** Places are geocoded with
  [Nominatim](https://nominatim.org/) and roads routed with
  [OSRM](https://project-osrm.org/), both OpenStreetMap projects — so any town
  anywhere works.
- **The schedule is derived, not typed.** Give it a sailing date and time and it
  works backwards through the check-in window and the drive to tell you when to
  set off. Change where you live and the departure time changes with it.
- **Two layers per day.** Driving and crossings are timed events inside a day;
  where you sleep is a separate band that spans days and overlaps the driving —
  the way a real calendar behaves.
- **Honest about gaps.** If a lookup fails you get a box to type the distance,
  never an invented number. Unpriced stops are excluded from the total and
  counted, rather than guessed.

## Running it

It's one file. Open `index.html`, or serve the folder:

```bash
python3 -m http.server 8000
```

## Publishing to GitHub Pages

```bash
git init
git add -A
git commit -m "Trip planner"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Then in the repo: **Settings → Pages → Source: Deploy from a branch → `main` / `root`**.

Pages serves over HTTPS from a real origin, so the map tiles and the geocoding
and routing calls all work — which they may not when the same file is opened
from `file://` or embedded in a sandboxed frame.

## Credits

Map tiles and geocoding © OpenStreetMap contributors. Routing by OSRM.
Map rendering by [Leaflet](https://leafletjs.com/).
