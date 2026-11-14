# Development status

## Challenge fit

MarsCraft is a Jezero-area, human Marswalk planning prototype for NASA Space Apps. It combines mapped terrain and mission context to plan an example EVA; it is not operational flight software.

| Challenge need | MarsCraft implementation |
|---|---|
| Multiple kinds of NASA science data | HRSC+MOLA elevation and derived slope; Viking, CTX and HiRISE optical imagery; THEMIS thermal mosaics; CRISM mineral context |
| Surface and mission context | Perseverance traverse and stops, MEDA weather archive, rover Navcam frames, and rover tilt compared with the coarse DEM |
| Route and science planning | A* Shortest, Balanced and Cautious profiles; selectable science waypoints; round-trip EVA scenario and time budget |
| Crew awareness | Computed season/daylight, archived weather clearly labelled, DONKI CME-arrival context, radiation limitations and pre-EVA checks |
| Usable field interface | Overview / Explorer / Planner workspaces, shareable workspace URLs, keyboard navigation, map layers, route elevation profile and mobile layout |

## Readiness and honest limits

The submission has a concrete Jezero EVA, several integrated data types, documented provenance and limitations, and offline snapshots for the NASA context feeds. It meets the challenge's core mapping and route-planning goals as a prototype. Review the data date and live-feed status in the interface and documentation when presenting.

- The working DEM is about 590 m per cell. It cannot resolve boulders, small scarps or other foot-scale hazards; its slope may understate local steepness.
- CTX, HiRISE, THEMIS and CRISM are visual context only; they do not affect route cost. CRISM is an approximate-georeferenced publication figure.
- Rover tilt is a three-metre vehicle attitude, not terrain slope. It is surfaced separately as a ground-truth caution and does not certify route safety.
- MEDA's public feed snapshot ends at sol 1133 (2024-04-27); the interface presents it as archived rather than current weather.
- DONKI WSA-ENLIL output predicts CME arrivals, not radiation dose or particle flux. An absence of predicted arrivals does not guarantee low radiation.
- Radiation figures are Curiosity RAD measurements from Gale crater, not Jezero measurements or operational limits.
- No integrated quantitative geologic-map layer or measured Jezero radiation feed is included. Links to challenge resources are clearly distinguished from integrated data.

See [DATA_SOURCES.md](./DATA_SOURCES.md) for product provenance and [METHODOLOGY.md](./METHODOLOGY.md) for assumptions, validation and safety caveats.
