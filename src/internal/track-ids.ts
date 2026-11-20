/**
 * The id shapes shared by exam tracks (`./tracks.ts`), the exam item log
 * (`./exam-schema.ts`) and the persisted `activeTrack` (`./state-schema.ts`).
 * One owner per pattern, so the three never drift apart.
 */

/**
 * A track code: 2 to 4 uppercase letters, a dash, then 1 or 2 uppercase
 * letters (such as `CCAR-F` or `CCDV-P`). Anchored, without the `m` flag, so
 * a trailing newline does not match.
 *
 * @example
 * ```ts
 * import { TRACK_CODE_PATTERN } from "./track-ids.ts";
 * TRACK_CODE_PATTERN.test("CCAR-F"); // true
 * TRACK_CODE_PATTERN.test("ccar-f"); // false
 * ```
 */
export const TRACK_CODE_PATTERN = /^[A-Z]{2,4}-[A-Z]{1,2}$/;

/**
 * A domain id: `D` then 1 to 99 without a leading zero (such as `D1`).
 *
 * @example
 * ```ts
 * import { DOMAIN_ID_PATTERN } from "./track-ids.ts";
 * DOMAIN_ID_PATTERN.test("D12"); // true
 * DOMAIN_ID_PATTERN.test("D123"); // false
 * ```
 */
export const DOMAIN_ID_PATTERN = /^D[1-9][0-9]?$/;

/**
 * An objective id: a domain id, a dot, then 1 to 99 without a leading zero
 * (such as `D1.2`). The first capture group is the domain id.
 *
 * @example
 * ```ts
 * import { OBJECTIVE_ID_PATTERN } from "./track-ids.ts";
 * OBJECTIVE_ID_PATTERN.exec("D10.12")?.[1]; // "D10"
 * OBJECTIVE_ID_PATTERN.test("D1.123"); // false
 * ```
 */
export const OBJECTIVE_ID_PATTERN = /^(D[1-9][0-9]?)\.[1-9][0-9]?$/;
