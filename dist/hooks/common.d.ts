/**
 * Helpers shared by the hook event handlers: reading payload fields safely
 * and resolving catalog titles.
 */
import { type CatalogEntry, type SessionId, type TopicId } from "../internal/schema.js";
/**
 * Reads an own payload field exactly once; an absent or only inherited field
 * reads as `undefined`.
 *
 * @param payload - The hook payload.
 * @param key - The field name.
 * @returns The field value, or `undefined` when it is not an own property.
 *
 * @example
 * ```ts
 * import { payloadField } from "./common.js";
 * payloadField({ prompt: "hi" }, "prompt"); // "hi"
 * ```
 */
export declare function payloadField(payload: Readonly<Record<string, unknown>>, key: string): unknown;
/**
 * The payload's `session_id` when it is a valid session id, else `null`
 * (the handler then does nothing).
 *
 * @param payload - The hook payload.
 * @returns The validated session id, or `null`.
 *
 * @example
 * ```ts
 * import { payloadSession } from "./common.js";
 * payloadSession({ session_id: "sess-1" }); // "sess-1"
 * payloadSession({ session_id: "a b" }); // null
 * ```
 */
export declare function payloadSession(payload: Readonly<Record<string, unknown>>): SessionId | null;
/**
 * The catalog title of `id`, or the id itself when the catalog lacks it.
 *
 * @param catalog - The merged catalog.
 * @param id - The topic id.
 * @returns A human-readable topic name.
 *
 * @example
 * ```ts
 * import { topicTitle } from "./common.js";
 * topicTitle([], "plan-mode" as Parameters<typeof topicTitle>[1]); // "plan-mode"
 * ```
 */
export declare function topicTitle(catalog: readonly CatalogEntry[], id: TopicId): string;
//# sourceMappingURL=common.d.ts.map