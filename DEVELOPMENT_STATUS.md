# Development status

Last updated: 2026-11-14.

## Challenge fit

MarsCraft is a layered planning view for a human Marswalk at Jezero. It is a **prototype for the Space Apps challenge**, not operational flight software.

| Need | Status |
|------|--------|
| Multiple NASA-related data types | Local DEM + slope/class; CRISM mineral figure; HiRISE footprint context; Viking/THEMIS via NASA Trek when network allows |
| Safety framing | Safety panel, Cautious defaults, unknown ≠ safe, EVA budget check |
| Concrete Marswalk | Round-trip Delta Margin EVA (landing → western delta → landing) |
| Route planning | A* with Shortest / Balanced / Cautious |
| Habitat-style UI | Detached panels, (i) tips, elevation profile under the map |

## Honest limits

- Working DEM cell size is about **590 m**. Sub-cell rocks and scarps are not resolved; slope classes can under-state local steepness relative to finer DTMs.
- Viking / THEMIS tiles require access to `trek.nasa.gov`. Local elevation / slope / class always work offline.
- CRISM overlay is a publication figure with approximate georeference.
- Radiation numbers are Curiosity RAD (Gale) order-of-magnitude figures, not Jezero measurements.
- Route profiles may coincide on flat floor terrain at this resolution.

## P0 trust fixes (2026-11-14)

- Radiation units corrected (mGy vs mSv).
- Demo redefined as round-trip EVA with budget check.
- Auto-zoom to planned route.
- Mars Trek tile matrix offset corrected and verified against live Viking / THEMIS sample tiles.
- Docs aligned with code; `dem_backup.*` removed from the distribution package.


## Thin P1 (2026-11-14)

- Identical-route explanation when all profiles share one corridor.
- POV stills on landing + delta POIs (local NASA images, credited).
- Walk-back reachability layer from start under Cautious rules (half of walking budget).
