# Trip planner

**Live: https://obatron.github.io/RoadTripplanner/**

Plot a road trip, budget it, and keep changing it as the plan moves. Distances and
drive times are looked up live from real road data; the budget works the way the
spreadsheet templates do — planned against actual, by category — and everything you
type is saved as you type it.

## What it does

**Route.** Type any two places and it geocodes them with
[Nominatim](https://nominatim.org/) and routes the roads with
[OSRM](https://project-osrm.org/) — so any town anywhere works and nothing is built
in. Add stops, **reorder them with the arrows**, or **click the map** to drop a stop
where you clicked. Each leg shows its km, its drive time and what the fuel costs.
Reordering re-routes immediately, so you can see a better order pay for itself.

**Crossings.** Optional ferry on any route. Give it a sailing date and time and it
works backwards through the check-in window and the drive to the terminal to tell you
what time to leave the house. A stop can sit on **either side of the crossing** —
before it, after it, before sailing home, or after — and a dropdown moves a stop
across the water. Overnight on the way to the terminal and the departure time walks
back through that night too; if that pushes you before your stated start date, it
says so and names the date.

**Itinerary.** Every day of the trip laid out, with the driving and crossings filled
in automatically and room to add your own items — a time, a title, a category and a
cost. Same days as a month calendar if you prefer that shape, where the driving sits
inside the day and the hotel band spans the nights.

**Budget.** Planned | Actual | Difference across seven categories. Lodging, fuel and
ferry are derived — lodging from nights × rates, fuel from **your car's L/100 km × your
$/litre × the real routed distance** — and everything else is a line you add. Set a
contingency %, and see the total per traveller and per day. The difference only ever
compares the lines you've actually filled in, so it never claims you're under budget
because you haven't entered receipts yet.

**Plots.** Where the money goes (planned against actual, by category), spend per day,
and the running total across the trip. Each chart has a table view, so no number is
reachable only by hovering.

**Saving.** Every change is written to your browser's local storage immediately —
closing the tab is safe. Keep several trips side by side, duplicate one to try a
variation, export a `.json` backup, export the budget as `.csv`, copy a shareable
link that carries the whole trip, or print to PDF. Nothing is uploaded anywhere.

**Honest about gaps.** If a route lookup fails you get a box to type the distance,
never an invented number. Stops with no nightly rate are counted and flagged, not
guessed. Fuel prices, hotel rates and ferry fares are asked for rather than made up.

## Running it

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`. Opening `index.html` straight off disk mostly
works, but a real HTTP origin is what the map tiles and lookups expect.

## Publishing

This repo is published to GitHub Pages from `main` / root, so pushing redeploys it:

```bash
git add -A && git commit -m "Update planner" && git push
```

## Files

| File | |
|---|---|
| `index.html` | markup |
| `styles.css` | design tokens and layout |
| `app.js` | state, lookups, schedule, budget maths, charts |
| `RESEARCH.md` | notes on Wanderlog / Roadtrippers / Sheets templates, and the gap analysis behind this version |

Chart colours are the validated categorical slots (blue / orange), checked for
colour-blind separation and contrast in both light and dark mode.

## Credits

Map tiles and geocoding © OpenStreetMap contributors. Routing by
[OSRM](https://project-osrm.org/). Map rendering by [Leaflet](https://leafletjs.com/).
