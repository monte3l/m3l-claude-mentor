/**
 * Preloaded with `node --import` into a CLI child: busy-waits until the
 * epoch-ms instant in M3L_START_AT, so every child starts its command at once.
 */
const startAt = Number(process.env["M3L_START_AT"] ?? "0");
while (Date.now() < startAt) {
  // Busy-wait on purpose: the barrier must release every child together.
}
