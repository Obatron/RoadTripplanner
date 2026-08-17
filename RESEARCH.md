# What the real planners do — and what this one was missing

Notes from looking at [Wanderlog](https://wanderlog.com/), [Roadtrippers](https://roadtrippers.com/),
and the common Google Sheets road-trip budget templates, used to decide what v2 needs.

## Wanderlog — the itinerary and budget model

- **Day-by-day itinerary** is the spine. Items are grouped **by day or by category**,
  drag-and-drop reorderable, shown as a visual timeline.
- **Distance and time between places** shown inline on a colour-coded map, so the
  list and the map are two views of the same ordered thing.
- **Optimize route** reorders stops to cut driving.
- **Budget**: set a trip budget, **assign a category to each expense**, then
  "visualise and compare how much you spent in **each category and each day**".
- **Expense splitting** across travellers — "see who owes who".
- Multi-currency, converted to a home currency.
- Free tier is unlimited trips/stops; offline maps are the paid gate.

## Roadtrippers — the route model

- **Waypoints** are the unit. Add by search or by tapping the map, then
  **reorder freely** and watch **mileage and fuel cost update**.
- **Fuel cost estimated from vehicle + route + gas price** — this is its one
  budgeting feature; it has no real expense tracking.
- Category colour-coding of stops; measure drive time from any waypoint.
- Exports a **PDF guide** and **GPX**; free tier caps at 3 stops (150 on Premium).

## Google Sheets templates — the budget columns

Nearly every template converges on the same shape:

- Categories: **Lodging, Fuel/Transport, Food, Activities, Misc** — road trips get
  extra transport sub-lines (fuel, tolls, parking, ferry).
- Columns: **Expected | Actual | Difference**, with per-category subtotals and a grand
  total. Difference = Expected − Actual.
- Per-line: date, category, description, amount, notes.
- Standard advice: add a **10–15 % contingency** on top of the estimate.

## Gap analysis — why v1 wasn't useful

| Missing | Consequence |
|---|---|
| **No persistence at all** | Every reload wiped the trip back to defaults. This alone made it unusable. |
| No reordering of stops | A stop added in the wrong place had to be deleted and retyped. |
| No day-by-day itinerary | Nowhere to put an activity, a booking, a time, or a note. |
| Budget was 3 inputs | No categories, no actuals, no difference, no per-person, no per-day. |
| No plots | Nothing to *see* — the ask was "plot my budget". |
| Fuel as "$ per 100 km" | Not how anyone knows their car. Should be **L/100 km × $/L**. |
| No export / share / print | Trip couldn't leave the browser. |
| Map was output-only | Couldn't click the map to add a stop. |
| Single trip | No way to keep two trips side by side. |
| No contingency | Templates all recommend one. |

## What v2 implements

Route (Roadtrippers-shaped): reorderable waypoints, click-map-to-add, per-leg km and
drive time, live fuel cost off the real routed distance.
Itinerary (Wanderlog-shaped): every day of the trip, auto drive/crossing events plus
your own timed items with category, cost and notes.
Budget (Sheets-shaped): Planned | Actual | Difference across seven categories, derived
lines for lodging/fuel/ferry, custom lines, contingency %, per-person and per-day.
Plots: planned-vs-actual by category, spend per day, cumulative spend.
Plus: autosave, multiple trips, JSON export/import, CSV, shareable link, print.

## Deliberately not built

- **Live gas prices** and **hotel rates** — both need a paid API key; the app asks you
  for the numbers instead of inventing them.
- **Curated POI database** (Roadtrippers' actual moat) — no free source for it.
- **Real-time collaboration** — needs a backend; this is a static page.
- **Route optimisation** — the travelling-salesman reorder is a genuine feature but
  belongs after the basics; stops reorder manually for now.
