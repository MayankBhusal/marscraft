/**
 * Demonstration Marswalk scenario for the Space Apps challenge.
 * Coordinates and times are planning assumptions for a short EVA concept,
 * not an operational timeline.
 */

export interface MissionScenario {
  id: string;
  title: string;
  /** One-paragraph science + ops goal. */
  objective: string;
  /** Habitat / airlock proxy POI id. */
  startPoiId: string;
  /** Ordered science waypoint POI ids (visited between start and destination). */
  waypointPoiIds: string[];
  /** Final stop POI id (for a round trip, same as start). */
  destinationPoiId: string;
  /** Assumed suited walking speed (km/h). */
  speedKmh: number;
  /** Total EVA concept length (hours), walk + science. */
  evaBudgetHours: number;
  /** Hours reserved for science stops (not walking). */
  scienceHours: number;
  /** Preferred cost profile after planning. */
  preferredProfile: "shortest" | "balanced" | "cautious";
  safetyPosture: string;
  notes: string[];
}

/**
 * Primary demo: habitat → western delta → habitat.
 * Sized to fit an 8 h EVA concept at 2 km/h with ~2 h science
 * (one-way ~5–6 km on the planning grid; round trip ~11–12 km).
 */
export const DELTA_MARGIN_EVA: MissionScenario = {
  id: "delta-margin-eva",
  title: "Jezero Delta Margin EVA (round trip)",
  objective:
    "From a habitat near Octavia E. Butler Landing, walk to the western delta deposit to inspect layered, carbonate-bearing materials reported from orbit, then return to the habitat. Primary science goal: link orbital mineral signatures (CRISM) to surface context on a walk that fits an 8-hour EVA budget at the assumed speed.",
  startPoiId: "perseverance-landing",
  waypointPoiIds: ["jezero-delta"],
  destinationPoiId: "perseverance-landing",
  speedKmh: 2.0,
  evaBudgetHours: 8,
  scienceHours: 2,
  preferredProfile: "cautious",
  safetyPosture:
    "Default to the Cautious cost profile. Prefer corridors with low unknown-slope share. Treat high-slope and unknown cells as avoid-or-justify. Confirm walking time + science time still fit the EVA budget after planning.",
  notes: [
    "Round trip: landing → western delta → landing. Destination equals start.",
    "Science time (2 h) is reserved at the delta and is not walking time.",
    "Times assume continuous suited walking at the stated speed with no suit or dust penalties.",
    "Nili Fossae and the crater-centre survey point are outside this short EVA radius.",
  ],
};

export const SCENARIOS: MissionScenario[] = [DELTA_MARGIN_EVA];
