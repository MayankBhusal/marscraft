# MarsCraft UI workspace redesign (iteration 1)

## What changed
- Added three persistent workspaces: Mission overview, Mars explorer, and Mission planner.
- Added a compact brand block and active-state navigation to the existing left panel.
- Kept workspace navigation within reach as a fixed bottom bar on mobile, while making the control sidebar independently scrollable so the map is easier to reach.
- Added clear keyboard focus rings to interactive controls and links.
- Added a workspace heading/action strip above the existing Leaflet map.
- Grouped existing panels by workspace using CSS visibility; React application state and the Leaflet map remain mounted while switching workspaces.
- Applied a restrained warm accent, clearer panel hierarchy, and responsive single-column layout for narrow screens.

## What deliberately did not change
- `src/core/*` terrain, grid, rendering, and A* route logic.
- `src/MapView.tsx` Leaflet map implementation and layer handling.
- Existing scientific data, source files, POIs, scenario, route exports, and EVA assumptions.
- Vite/React/TypeScript architecture. No Next.js code or coworker map renderer was imported.

## Workspace contents
- **Mission overview:** quick-start guidance, data summary, and demonstration mission scenario.
- **Mars explorer:** layer controls, legend, data summary, selected-location information, and safety context.
- **Mission planner:** layer controls, safety context, scenario brief, route inputs, route comparison, and route summary.

## Validation
- TypeScript/TSX transpilation syntax check passed for `src/App.tsx`, `src/ui.tsx`, and `src/MapView.tsx`.
- Full `npm run build` could not be completed in this environment because `npm ci` did not finish installing the dependencies (`@types/node` and Vite's client types were unavailable). Re-run `npm ci` in a normal development environment, then `npm run build` and `npm test`.

## Suggested local test
```bash
npm ci
npm run build
npm test
npm run dev
```

Switch between all three workspaces and verify that the selected map location, selected POI, waypoints, planned routes, active route, and elevation profile remain intact. Test the layout at desktop and mobile widths.
