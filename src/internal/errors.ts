/**
 * The typed error raised by the mentor's state layer (data directory
 * resolution, file I/O, parsing, validation, import and export).
 */

/**
 * Why a state operation failed.
 *
 * @example
 * ```ts
 * import type { MentorErrorCode } from "./errors.js";
 * const code: MentorErrorCode = "DATA_DIR_UNSET";
 * ```
 */
export type MentorErrorCode =
  | "DATA_DIR_UNSET"
  | "DATA_DIR_INVALID"
  | "READ_FAILED"
  | "PARSE_FAILED"
  | "VALIDATION_FAILED"
  | "WRITE_FAILED"
  | "TOO_LARGE"
  | "IMPORT_INVALID"
  | "CONFIRMATION_REQUIRED";

/**
 * An error from the mentor's state layer, discriminated by {@link
 * MentorErrorCode}. Callers pass a fixed-text message (optionally with a file
 * base name or a parser reason); this class does not inspect or redact it.
 * `cause` is set only when the caller supplies one.
 *
 * @example
 * ```ts
 * import { MentorStateError } from "./errors.js";
 * try {
 *   throw new MentorStateError("READ_FAILED", "could not read state.json");
 * } catch (error) {
 *   if (error instanceof MentorStateError && error.code === "READ_FAILED") {
 *     console.error(error.message);
 *   }
 * }
 * ```
 */
export class MentorStateError extends Error {
  /** The failure category. */
  readonly code: MentorErrorCode;

  /**
   * @param code - The failure category.
   * @param message - Fixed text; never file contents or raw input.
   * @param options - `cause` is forwarded only when it is an own property.
   */
  constructor(
    code: MentorErrorCode,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(
      message,
      options !== undefined && Object.hasOwn(options, "cause")
        ? { cause: options.cause }
        : undefined,
    );
    this.name = "MentorStateError";
    this.code = code;
  }
}

/**
 * Whether `value` is a {@link MentorStateError} (an `instanceof` check, so a
 * look-alike plain object is rejected).
 *
 * @example
 * ```ts
 * import { isMentorStateError } from "./errors.js";
 * try {
 *   JSON.parse("{");
 * } catch (error) {
 *   if (!isMentorStateError(error)) throw error;
 * }
 * ```
 */
export function isMentorStateError(value: unknown): value is MentorStateError {
  return value instanceof MentorStateError;
}
