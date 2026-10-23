import { describe, expect, it } from "vitest";

import { MISS_GAP_MS, reconcileSource } from "@/lib/freeJobs/reconcile";
import type { Job } from "@/lib/types";

const T = 1_800_000_000_000;
const job = (id: string, extra: Partial<Job> = {}): Job => ({
  id,
  title: "Manager",
  company: "X",
  location: "Abu Dhabi",
  salary: null,
  description: "d",
  applyLink: null,
  source: null,
  postedAt: null,
  ...extra,
});
const listing = (jobs: Job[], listed: string[], incomplete = false) => ({
  jobs,
  listedIds: new Set(listed),
  incomplete,
});
const eligible = () => true;

describe("reconcileSource", () => {
  it("stamps firstSeenAt on a new job and keeps it on a known one", () => {
    const result = reconcileSource(listing([job("a"), job("b")], ["a", "b"]), [job("b", { firstSeenAt: 5 })], T, eligible);
    expect(result.find((j) => j.id === "a")?.firstSeenAt).toBe(T);
    expect(result.find((j) => j.id === "b")?.firstSeenAt).toBe(5);
  });

  it("keeps a job on its first miss and drops it on the second", () => {
    const previous = [job("gone", { firstSeenAt: 1 })];
    const first = reconcileSource(listing([], []), previous, T, eligible);
    expect(first).toHaveLength(1);
    expect(first[0].missedSyncs).toBe(1);

    const second = reconcileSource(listing([], []), first, T + MISS_GAP_MS, eligible);
    expect(second).toHaveLength(0);
  });

  it("counts two syncs close together as one miss", () => {
    const first = reconcileSource(listing([], []), [job("gone")], T, eligible);
    const soon = reconcileSource(listing([], []), first, T + 60_000, eligible);
    expect(soon).toHaveLength(1);
    expect(soon[0].missedSyncs).toBe(1);
  });

  it("forgets earlier misses when the job comes back", () => {
    const missed = [job("back", { firstSeenAt: 1, missedSyncs: 1, lastMissedAt: T })];
    const result = reconcileSource(
      listing([job("back", { missedSyncs: 1, lastMissedAt: T })], ["back"]),
      missed,
      T + MISS_GAP_MS,
      eligible
    );
    expect(result[0].missedSyncs).toBeUndefined();
    expect(result[0].lastMissedAt).toBeUndefined();
    expect(result[0].firstSeenAt).toBe(1);
  });

  it("drops at once a job the site still lists but that no longer qualifies", () => {
    const result = reconcileSource(listing([], ["old"]), [job("old")], T, eligible);
    expect(result).toHaveLength(0);
  });

  it("keeps unread jobs of an incomplete listing without counting a miss", () => {
    const result = reconcileSource(listing([], [], true), [job("unread")], T, eligible);
    expect(result).toHaveLength(1);
    expect(result[0].missedSyncs).toBeUndefined();
  });

  it("drops an unlisted job that no longer passes the current rules", () => {
    const result = reconcileSource(listing([], []), [job("stale")], T, () => false);
    expect(result).toHaveLength(0);
  });
});
