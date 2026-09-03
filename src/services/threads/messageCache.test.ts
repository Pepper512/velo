import { describe, it, expect, vi } from "vitest";
import { createMessageCache, sameMessages } from "./messageCache";
import type { DbMessage } from "../db/messages";

/**
 * SPEC-SB SB-2 (REQ-2): a small stale-while-revalidate cache of a thread's
 * messages — peek for the first paint, load to refresh, prefetch neighbours
 * one at a time, clear on sync.
 */

function msg(id: string, date = 1): DbMessage {
  return { id, thread_id: "t", account_id: "a", date } as unknown as DbMessage;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("createMessageCache", () => {
  it("peek is null until a load stores the messages, then returns them", async () => {
    const loader = vi.fn(async (_a: string, t: string) => [msg(`${t}-1`)]);
    const cache = createMessageCache(loader);
    expect(cache.peek("acc", "t1")).toBeNull();
    const loaded = await cache.load("acc", "t1");
    expect(loaded).toEqual([msg("t1-1")]);
    expect(cache.peek("acc", "t1")).toEqual([msg("t1-1")]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("keys by account and thread", async () => {
    const cache = createMessageCache(async (a, t) => [msg(`${a}:${t}`)]);
    await cache.load("a1", "t");
    expect(cache.peek("a2", "t")).toBeNull();
  });

  it("load always re-queries (stale-while-revalidate) and replaces the entry", async () => {
    let n = 0;
    const cache = createMessageCache(async () => [msg(`m${++n}`)]);
    await cache.load("acc", "t1");
    await cache.load("acc", "t1");
    expect(cache.peek("acc", "t1")).toEqual([msg("m2")]);
  });

  it("evicts the least recently used entry beyond the capacity (REQ-2.2)", async () => {
    const cache = createMessageCache(async (_a, t) => [msg(t)], { capacity: 2 });
    await cache.load("acc", "t1");
    await cache.load("acc", "t2");
    cache.peek("acc", "t1"); // t1 is now the most recently used
    await cache.load("acc", "t3");
    expect(cache.peek("acc", "t2")).toBeNull();
    expect(cache.peek("acc", "t1")).not.toBeNull();
    expect(cache.peek("acc", "t3")).not.toBeNull();
    expect(cache.size()).toBe(2);
  });

  it("clear empties everything", async () => {
    const cache = createMessageCache(async (_a, t) => [msg(t)]);
    await cache.load("acc", "t1");
    cache.clear();
    expect(cache.peek("acc", "t1")).toBeNull();
    expect(cache.size()).toBe(0);
  });

  it("prefetch loads uncached threads one at a time, in order, skipping cached ones (REQ-2.3)", async () => {
    const calls: string[] = [];
    const gates = new Map<string, ReturnType<typeof deferred<DbMessage[]>>>();
    const cache = createMessageCache((_a, t) => {
      calls.push(t);
      const d = deferred<DbMessage[]>();
      gates.set(t, d);
      return d.promise;
    });
    await (async () => {
      const d = deferred<DbMessage[]>();
      const p = cache.load("acc", "t2");
      gates.get("t2")!.resolve([msg("t2")]);
      await p;
      void d;
    })();
    calls.length = 0;

    const done = cache.prefetch("acc", ["t1", "t2", "t3"]);
    await Promise.resolve();
    expect(calls).toEqual(["t1"]); // t2 is cached; t3 waits for t1
    gates.get("t1")!.resolve([msg("t1")]);
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual(["t1", "t3"]);
    gates.get("t3")!.resolve([msg("t3")]);
    await done.finished;
    expect(cache.peek("acc", "t3")).toEqual([msg("t3")]);
  });

  it("a cancelled prefetch stops before the next thread", async () => {
    const calls: string[] = [];
    const gates = new Map<string, ReturnType<typeof deferred<DbMessage[]>>>();
    const cache = createMessageCache((_a, t) => {
      calls.push(t);
      const d = deferred<DbMessage[]>();
      gates.set(t, d);
      return d.promise;
    });
    const job = cache.prefetch("acc", ["t1", "t2"]);
    await Promise.resolve();
    job.cancel();
    gates.get("t1")!.resolve([msg("t1")]);
    await job.finished;
    expect(calls).toEqual(["t1"]);
    // The in-flight result is still kept — it was paid for.
    expect(cache.peek("acc", "t1")).toEqual([msg("t1")]);
  });

  it("a failing loader leaves no entry and does not break the prefetch chain", async () => {
    const cache = createMessageCache(async (_a, t) => {
      if (t === "bad") throw new Error("db");
      return [msg(t)];
    });
    await cache.prefetch("acc", ["bad", "good"]).finished;
    expect(cache.peek("acc", "bad")).toBeNull();
    expect(cache.peek("acc", "good")).toEqual([msg("good")]);
    await expect(cache.load("acc", "bad")).rejects.toThrow("db");
  });
});

describe("sameMessages", () => {
  it("is true for the same ids and dates in order, false otherwise", () => {
    expect(sameMessages([msg("a", 1), msg("b", 2)], [msg("a", 1), msg("b", 2)])).toBe(true);
    expect(sameMessages([msg("a", 1)], [msg("a", 2)])).toBe(false);
    expect(sameMessages([msg("a")], [msg("a"), msg("b")])).toBe(false);
    expect(sameMessages([], [])).toBe(true);
  });
});
