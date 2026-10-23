import { describe, expect, it } from "vite-plus/test";

import {
  bucketByTime,
  visibleBucketItems,
  countByTimeBucket,
  sidebarThreadTimeMs,
  sidebarTimeBucketOf,
  sortThreadsByRecency,
} from "./sidebarTimeBuckets";

const NOW_MS = new Date(2026, 9, 23, 15, 30).getTime();

function localMs(day: number, hour = 12): number {
  return new Date(2026, 9, day, hour).getTime();
}

describe("sidebarTimeBucketOf", () => {
  it.each([
    ["the start of today", new Date(2026, 9, 23, 0, 0).getTime(), "today"],
    ["a moment later today", localMs(23, 14), "today"],
    ["a clock slightly ahead", localMs(23, 18), "today"],
    ["the last minute of yesterday", new Date(2026, 9, 22, 23, 59).getTime(), "week"],
    ["six days ago", new Date(2026, 9, 17, 0, 0).getTime(), "week"],
    ["the last minute of seven days ago", new Date(2026, 9, 16, 23, 59).getTime(), "older"],
    ["last month", localMs(1), "older"],
    ["an unreadable time", Number.NaN, "older"],
  ] as const)("places %s in %s", (_, timeMs, bucket) => {
    expect(sidebarTimeBucketOf(timeMs, NOW_MS)).toBe(bucket);
  });

  it("counts calendar days across a month boundary", () => {
    const nowMs = new Date(2026, 10, 2, 9).getTime();
    expect(sidebarTimeBucketOf(new Date(2026, 9, 28, 9).getTime(), nowMs)).toBe("week");
    expect(sidebarTimeBucketOf(new Date(2026, 9, 26, 9).getTime(), nowMs)).toBe("older");
  });
});

describe("bucketByTime", () => {
  it("orders buckets Today, This week, Older and keeps input order inside each", () => {
    const items = [
      { id: "a", timeMs: localMs(10) },
      { id: "b", timeMs: localMs(23, 9) },
      { id: "c", timeMs: localMs(20) },
      { id: "d", timeMs: localMs(23, 8) },
    ];

    expect(
      bucketByTime(items, (item) => item.timeMs, NOW_MS).map((group) => ({
        label: group.label,
        ids: group.items.map((item) => item.id),
      })),
    ).toEqual([
      { label: "Today", ids: ["b", "d"] },
      { label: "This week", ids: ["c"] },
      { label: "Older", ids: ["a"] },
    ]);
  });

  it("drops empty buckets", () => {
    expect(
      bucketByTime([localMs(1)], (timeMs) => timeMs, NOW_MS).map((group) => group.bucket),
    ).toEqual(["older"]);
    expect(bucketByTime([], (timeMs: number) => timeMs, NOW_MS)).toEqual([]);
  });
});

describe("countByTimeBucket", () => {
  it("counts every item, including ones the list has not loaded", () => {
    const counts = countByTimeBucket(
      [localMs(23, 9), localMs(20), localMs(10), localMs(1), Number.NaN],
      (timeMs) => timeMs,
      NOW_MS,
    );

    expect(Object.fromEntries(counts)).toEqual({ today: 1, week: 1, older: 3 });
  });
});

describe("sortThreadsByRecency", () => {
  const thread = (id: string, latestUserMessageAt: string | null, updatedAt: string) => ({
    id,
    latestUserMessageAt,
    updatedAt,
  });

  it("orders by the last prompt, falls back to the update time, and breaks ties by id", () => {
    const sorted = sortThreadsByRecency([
      thread("old", "2026-10-20T09:00:00.000Z", "2026-10-23T09:00:00.000Z"),
      thread("never-prompted", null, "2026-10-22T09:00:00.000Z"),
      thread("b-new", "2026-10-23T08:00:00.000Z", "2026-10-23T08:00:00.000Z"),
      thread("a-new", "2026-10-23T08:00:00.000Z", "2026-10-23T08:00:00.000Z"),
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual(["a-new", "b-new", "never-prompted", "old"]);
  });

  it("reads the time the sort and the buckets share", () => {
    expect(sidebarThreadTimeMs(thread("t", null, "2026-10-22T09:00:00.000Z"))).toBe(
      Date.parse("2026-10-22T09:00:00.000Z"),
    );
  });
});

describe("visibleBucketItems", () => {
  const items = ["a", "b", "c"];

  it("shows every item of an open bucket", () => {
    expect(visibleBucketItems(items, false, (item) => item === "b")).toEqual(items);
  });

  it("keeps only the open thread of a collapsed bucket", () => {
    expect(visibleBucketItems(items, true, (item) => item === "b")).toEqual(["b"]);
    expect(visibleBucketItems(items, true, () => false)).toEqual([]);
  });
});
