/**
 * Per-topic relevance weights of an exam track, shared by the CLI (the
 * profile command's exam weights) and the SessionStart hook (track-first
 * topic ordering).
 */
import type { Track } from "./tracks.ts";

/**
 * Each mapped topic's relevance weight in `track`: the sum, over the
 * objectives that map the topic, of the owning domain's weight divided by
 * that domain's objective count (each mapping objective contributes its
 * full share), rounded to 2 decimals. This is a relevance weight, NOT the
 * topic's share of the exam: an objective that maps several topics credits
 * each of them in full, so the weights can total more than 100. Keys are
 * inserted in track order; a topic no objective maps is absent.
 *
 * @example
 * ```ts
 * import { loadBundledTracks } from "./bundled-tracks.ts";
 * import { trackTopicWeights } from "./track-weights.ts";
 * const track = loadBundledTracks().find((t) => t.code === "CCDV-F");
 * const weights = track === undefined ? {} : trackTopicWeights(track);
 * weights["hooks"]; // 12.33
 * ```
 */
export function trackTopicWeights(track: Track): Record<string, number> {
  const sums = new Map<string, number>();
  for (const domain of track.domains) {
    const share = domain.weight / domain.objectives.length;
    for (const objective of domain.objectives) {
      for (const topic of objective.topics) {
        sums.set(topic, (sums.get(topic) ?? 0) + share);
      }
    }
  }
  return Object.fromEntries(
    [...sums].map(([topic, sum]) => [topic, Math.round(sum * 100) / 100]),
  );
}
