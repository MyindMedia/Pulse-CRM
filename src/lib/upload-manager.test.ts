import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DONE_LINGER_MS, createUploadManager, isFolderDrop, type UploadContext, type UploadTask } from "./upload-manager";

/* The session upload store (F2-20, F2-24). Jobs here are fakes the test
   resolves by hand, so every step of a run is visible. */

type Deferred = { promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void };
function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A task whose run waits for the test. `ctx` is the last context it got. */
function fakeTask(name: string, size = 100) {
  const gate = deferred();
  const calls: string[] = [];
  const t = {
    gate,
    calls,
    ctx: null as UploadContext | null,
    task: {
      name,
      size,
      errorText: (err: unknown) => (err instanceof Error ? err.message : "Upload failed."),
      onDone: () => calls.push("onDone"),
      run: async (ctx: UploadContext) => {
        t.ctx = ctx;
        calls.push("run");
        await gate.promise;
      },
    } satisfies UploadTask,
  };
  return t;
}

/** Let the microtask queue drain (the store chains a few promises per step). */
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function fakeWindow() {
  const listeners = new Map<string, EventListener>();
  return {
    listeners,
    addEventListener: vi.fn((type: string, fn: EventListener) => listeners.set(type, fn)),
    removeEventListener: vi.fn((type: string) => listeners.delete(type)),
  };
}

let ids = 0;
const newId = () => `u${++ids}`;

beforeEach(() => {
  ids = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("upload manager", () => {
  it("adds rows as queued and starts at most two, oldest first", async () => {
    const m = createUploadManager({ newId, unloadTarget: null });
    const [a, b, c] = [fakeTask("a.wav"), fakeTask("b.wav"), fakeTask("c.wav")];
    m.add("s1", [a.task, b.task, c.task]);
    await flush();
    expect(m.rows("s1").map((r) => [r.name, r.status])).toEqual([
      ["a.wav", "uploading"],
      ["b.wav", "uploading"],
      ["c.wav", "queued"],
    ]);
    expect(c.calls).toEqual([]);
    a.gate.resolve();
    await flush();
    expect(m.rows("s1").map((r) => r.status)).toEqual(["done", "uploading", "uploading"]);
    expect(c.calls).toEqual(["run"]);
  });

  it("the cap of two holds across bookings, and each row stays on its own booking", async () => {
    const m = createUploadManager({ newId, unloadTarget: null });
    const [a, b, c] = [fakeTask("a.wav"), fakeTask("b.wav"), fakeTask("c.wav")];
    m.add("s1", [a.task, b.task]);
    m.add("s2", [c.task]);
    await flush();
    expect(m.rows("s1").map((r) => r.status)).toEqual(["uploading", "uploading"]);
    expect(m.rows("s2").map((r) => [r.name, r.status])).toEqual([["c.wav", "queued"]]);
    b.gate.resolve();
    await flush();
    expect(m.rows("s2")[0].status).toBe("uploading");
    c.gate.resolve();
    a.gate.resolve();
    await flush();
    expect(m.rows("s1").map((r) => r.name)).toEqual(["a.wav", "b.wav"]);
    expect(m.rows("s2").map((r) => r.name)).toEqual(["c.wav"]);
  });

  it("cancel on a queued row: it never runs; on a running row: its signal aborts and the next starts", async () => {
    const m = createUploadManager({ newId, unloadTarget: null });
    const [a, b, c] = [fakeTask("a"), fakeTask("b"), fakeTask("c")];
    m.add("s1", [a.task, b.task, c.task]);
    await flush();
    const [ra, , rc] = m.rows("s1");
    m.cancel(rc.id);
    m.cancel(ra.id);
    expect(a.ctx!.signal.aborted).toBe(true);
    a.gate.reject(new DOMException("Upload canceled.", "AbortError"));
    await flush();
    expect(m.rows("s1").map((r) => r.status)).toEqual(["canceled", "uploading", "canceled"]);
    expect(c.calls).toEqual([]);
    expect(a.calls).not.toContain("onDone");
  });

  it("after commit, cancel is ignored and the row ends Uploaded (F2-24)", async () => {
    const m = createUploadManager({ newId, unloadTarget: null });
    const a = fakeTask("a.wav");
    m.add("s1", [a.task]);
    await flush();
    a.ctx!.commit();
    m.cancel(m.rows("s1")[0].id);
    expect(a.ctx!.signal.aborted).toBe(false);
    a.gate.resolve();
    await flush();
    expect(m.rows("s1")[0].status).toBe("done");
    expect(a.calls).toEqual(["run", "onDone"]);
  });

  it("commit after a cancel throws an AbortError so the job stops before its writes", async () => {
    const m = createUploadManager({ newId, unloadTarget: null });
    const a = fakeTask("a.wav");
    m.add("s1", [a.task]);
    await flush();
    m.cancel(m.rows("s1")[0].id);
    expect(() => a.ctx!.commit()).toThrowError(expect.objectContaining({ name: "AbortError" }));
  });

  it("a failure shows the job's reason on that row only", async () => {
    const m = createUploadManager({ newId, unloadTarget: null });
    const [a, b] = [fakeTask("a.html"), fakeTask("b.wav")];
    m.add("s1", [a.task, b.task]);
    await flush();
    a.gate.reject(new Error("That file type is not supported."));
    await flush();
    expect(m.rows("s1")[0]).toMatchObject({ status: "failed", error: "That file type is not supported." });
    expect(m.rows("s1")[1].status).toBe("uploading");
  });

  it("keeps running with nobody watching, and a new watcher sees the rows (panel closed and reopened)", async () => {
    const m = createUploadManager({ newId, unloadTarget: null });
    const [a, b, c] = [fakeTask("a"), fakeTask("b"), fakeTask("c")];
    const panel = vi.fn();
    const unsubscribe = m.subscribe(panel);
    m.add("s1", [a.task, b.task, c.task]);
    await flush();
    unsubscribe(); // the panel closes
    a.gate.resolve();
    await flush();
    expect(c.calls).toEqual(["run"]); // the queued one still started
    b.gate.resolve();
    c.gate.resolve();
    await flush();
    const reopened = vi.fn();
    m.subscribe(reopened);
    expect(m.rows("s1").map((r) => r.status)).toEqual(["done", "done", "done"]);
    expect([a, b, c].every((t) => t.calls.includes("onDone"))).toBe(true);
  });

  it("finished rows clear after four seconds; failed and canceled rows wait to be dismissed", async () => {
    const m = createUploadManager({ newId, unloadTarget: null });
    const [a, b] = [fakeTask("a"), fakeTask("b")];
    m.add("s1", [a.task, b.task]);
    await flush();
    a.gate.resolve();
    b.gate.reject(new Error("nope"));
    await flush();
    vi.advanceTimersByTime(DONE_LINGER_MS - 1);
    expect(m.rows("s1")).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(m.rows("s1").map((r) => r.name)).toEqual(["b"]);
    m.dismiss(m.rows("s1")[0].id);
    expect(m.rows("s1")).toEqual([]);
  });

  it("returns the same rows array until something changes (useSyncExternalStore needs that)", async () => {
    const m = createUploadManager({ newId, unloadTarget: null });
    expect(m.rows("nobody")).toBe(m.rows("nobody"));
    const a = fakeTask("a");
    m.add("s1", [a.task]);
    await flush();
    const first = m.rows("s1");
    expect(m.rows("s1")).toBe(first);
    a.ctx!.onProgress(50, 100);
    expect(m.rows("s1")).not.toBe(first);
  });

  it("holds the beforeunload guard while anything is queued or running, and drops it after", async () => {
    const win = fakeWindow();
    const m = createUploadManager({ newId, unloadTarget: win });
    const a = fakeTask("a");
    m.add("s1", [a.task]);
    expect(win.addEventListener).toHaveBeenCalledTimes(1);
    const event = { preventDefault: vi.fn(), returnValue: undefined as unknown };
    win.listeners.get("beforeunload")!(event as unknown as Event);
    expect(event.preventDefault).toHaveBeenCalled();
    await flush();
    a.gate.resolve();
    await flush();
    expect(win.removeEventListener).toHaveBeenCalledTimes(1);
    expect(win.listeners.has("beforeunload")).toBe(false);
  });

  it("refuse adds a failed row with the reason and uploads nothing", () => {
    const m = createUploadManager({ newId, unloadTarget: null });
    m.refuse("s1", "Session folder", "Folders cannot be uploaded. Zip it first.");
    expect(m.rows("s1")).toEqual([
      expect.objectContaining({ name: "Session folder", status: "failed", error: "Folders cannot be uploaded. Zip it first." }),
    ]);
    expect(m.busy()).toBe(false);
  });

  it("announces started, uploaded, failed and canceled once each, per booking", async () => {
    const m = createUploadManager({ newId, unloadTarget: null });
    const [a, b] = [fakeTask("a.wav"), fakeTask("b.wav")];
    m.add("s1", [a.task]);
    await flush();
    expect(m.announcement("s1")).toBe("Uploading a.wav.");
    expect(m.announcement("s2")).toBe("");
    vi.advanceTimersByTime(5000);
    a.gate.reject(new Error("That file type is not supported."));
    await flush();
    expect(m.announcement("s1")).toBe("Could not upload a.wav. That file type is not supported.");
    vi.advanceTimersByTime(5000);
    m.add("s1", [b.task]);
    await flush();
    vi.advanceTimersByTime(5000);
    m.cancel(m.rows("s1")[1].id);
    expect(m.announcement("s1")).toBe("Canceled b.wav.");
    b.gate.reject(new DOMException("Upload canceled.", "AbortError"));
    await flush();
    expect(m.announcement("s1")).toBe("Canceled b.wav.");
  });
});

describe("upload manager: the Files section's status line (V3-01)", () => {
  it("say() puts another control's result on the same line, per booking", () => {
    const m = createUploadManager({ newId, unloadTarget: null });
    const seen = vi.fn();
    m.subscribe(seen);
    m.say("s1", "Final: Mix v3.wav");
    expect(m.announcement("s1")).toBe("Final: Mix v3.wav");
    expect(m.announcement("s2")).toBe("");
    expect(seen).toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    m.say("s1", "Not final: Mix v3.wav");
    expect(m.announcement("s1")).toBe("Not final: Mix v3.wav");
  });

  it("joins with an upload event that lands at the same moment", async () => {
    const m = createUploadManager({ newId, unloadTarget: null });
    const a = fakeTask("a.wav");
    m.add("s1", [a.task]);
    await flush();
    m.say("s1", "Final: b.wav");
    expect(m.announcement("s1")).toBe("Uploading a.wav. Final: b.wav");
  });

  it("ignores an empty line", () => {
    const m = createUploadManager({ newId, unloadTarget: null });
    m.say("s1", "Final: a.wav");
    m.say("s1", "   ");
    expect(m.announcement("s1")).toBe("Final: a.wav");
  });
});

describe("isFolderDrop", () => {
  it("is true only for a directory entry", () => {
    expect(isFolderDrop({ webkitGetAsEntry: () => ({ isDirectory: true }) })).toBe(true);
    expect(isFolderDrop({ webkitGetAsEntry: () => ({ isDirectory: false }) })).toBe(false);
    expect(isFolderDrop({ webkitGetAsEntry: () => null })).toBe(false);
    expect(isFolderDrop({})).toBe(false);
  });
});
