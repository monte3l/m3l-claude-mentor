/** Shared fixtures for the track tests: a valid document and an edit helper. */

export function validTrack(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    code: "CCAR-F",
    title: "Claude Certified Architect Foundations",
    tier: "foundations",
    assumes: null,
    guide: {
      version: "1.0",
      effective: "2026-03",
      sourceUrl: "https://example.com/guide",
      reviewedAt: "2026-11-01",
    },
    format: {
      minutes: 120,
      passScaled: 720,
      scaleMax: 1000,
      itemKinds: ["single", "multiple"],
    },
    scenarios: [{ id: "S1", summary: "A scenario", domains: ["D1"] }],
    domains: [
      {
        id: "D1",
        name: "First",
        weight: 60,
        objectives: [
          {
            id: "D1.1",
            officialRef: "1.1",
            summary: "Objective one",
            topics: ["plan-mode", "claude-md"],
            external: ["Read the guide"],
          },
          { id: "D1.2", summary: "Objective two", topics: ["plan-mode"] },
        ],
      },
      {
        id: "D2",
        name: "Second",
        weight: 40,
        objectives: [
          { id: "D2.1", summary: "Objective three", topics: ["hooks"] },
        ],
      },
    ],
  };
}

export type Path = readonly (string | number)[];
export type Edit = readonly [path: Path, value: unknown];
type Container = Record<string | number, unknown>;

/** Marks an edit that deletes the property at its path. */
export const REMOVE = Symbol("remove");

/** Deep-clones the valid track and applies each edit (set or REMOVE). */
export function mutated(...edits: Edit[]): unknown {
  const root = structuredClone(validTrack());
  for (const [path, value] of edits) {
    let parent: unknown = root;
    for (const key of path.slice(0, -1)) {
      parent = (parent as Container)[key];
    }
    const last = path.at(-1) as string | number;
    if (value === REMOVE) delete (parent as Container)[last];
    else (parent as Container)[last] = value;
  }
  return root;
}
