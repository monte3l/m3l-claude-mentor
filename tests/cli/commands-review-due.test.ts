import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  REVIEW_INTERVAL_DAYS,
  reviewIntervalMs,
} from "../../src/internal/mastery.ts";
import { defaultProfile } from "../../src/internal/state-schema.ts";
import { saveProfile } from "../../src/internal/store.ts";
import { DAY, NOW, makeSandbox, runOk, type Sandbox } from "./helpers.ts";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

async function reviewDue(
  passes: number,
  lastPassAt: number | null,
): Promise<boolean | undefined> {
  await saveProfile(sb.dir, {
    ...defaultProfile(),
    topics: {
      "plan-mode": { introduced: true, level: "Applied", lastPassAt, passes },
    },
  });
  const out = (await runOk(sb.dir, ["get-profile"])) as {
    topics: { reviewDue: boolean }[];
  };
  return out.topics[0]?.reviewDue;
}

describe("get-profile reviewDue across pass counts", () => {
  test("the spacing schedule is pinned", () => {
    expect([...REVIEW_INTERVAL_DAYS]).toEqual([1, 3, 7, 14, 30]);
    expect(reviewIntervalMs(0)).toBe(DAY);
    expect(reviewIntervalMs(2)).toBe(7 * DAY);
    expect(reviewIntervalMs(99)).toBe(30 * DAY);
  });

  test.each([0, 1, 2, 3, 4, 5, 99])(
    "passes=%i: due exactly at reviewIntervalMs, not 1 ms before",
    async (passes) => {
      const interval = reviewIntervalMs(passes);
      expect(await reviewDue(passes, NOW - interval)).toBe(true);
      expect(await reviewDue(passes, NOW - interval + 1)).toBe(false);
    },
  );

  test.each([0, 3, 99])(
    "passes=%i: a null lastPassAt is never due",
    async (passes) => {
      expect(await reviewDue(passes, null)).toBe(false);
    },
  );
});
