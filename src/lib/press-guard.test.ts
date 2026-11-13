import { describe, expect, it } from "vitest";
import { createPressGuard } from "./press-guard";

/* V3-01: a control stays focusable while its request runs, so repeat
   presses are refused by this guard instead of by `disabled`. */

function gate() {
  let open!: () => void;
  let fail!: (e: unknown) => void;
  const promise = new Promise<string>((res, rej) => {
    open = () => res("done");
    fail = rej;
  });
  return { promise, open, fail };
}

describe("createPressGuard", () => {
  it("runs the first press and refuses repeats of the same key until it settles", async () => {
    const g = createPressGuard();
    const first = gate();
    let calls = 0;
    const press = () =>
      g.run("final:a", () => {
        calls++;
        return first.promise;
      });
    const a = press();
    const b = press(); // same tick: state has not re-rendered yet
    expect(g.busy("final:a")).toBe(true);
    expect(calls).toBe(1);
    await expect(b).resolves.toEqual({ ran: false });
    first.open();
    await expect(a).resolves.toEqual({ ran: true, value: "done" });
    expect(g.busy("final:a")).toBe(false);
    const again = gate();
    const c = g.run("final:a", () => again.promise);
    expect(g.busy("final:a")).toBe(true);
    again.open();
    await c;
  });

  it("different keys run side by side", async () => {
    const g = createPressGuard();
    const [x, y] = [gate(), gate()];
    const a = g.run("final:a", () => x.promise);
    const b = g.run("final:b", () => y.promise);
    expect(g.busy("final:a") && g.busy("final:b")).toBe(true);
    x.open();
    y.open();
    await expect(Promise.all([a, b])).resolves.toEqual([
      { ran: true, value: "done" },
      { ran: true, value: "done" },
    ]);
  });

  it("anyBusy covers a group of controls that share one request at a time", async () => {
    const g = createPressGuard();
    expect(g.anyBusy()).toBe(false);
    const x = gate();
    const a = g.run("ready", () => x.promise);
    expect(g.anyBusy()).toBe(true);
    x.open();
    await a;
    expect(g.anyBusy()).toBe(false);
  });

  it("a failed request frees the key and the error reaches the caller", async () => {
    const g = createPressGuard();
    const x = gate();
    const a = g.run("copy", () => x.promise);
    x.fail(new Error("nope"));
    await expect(a).rejects.toThrow("nope");
    expect(g.busy("copy")).toBe(false);
  });

  it("a function that throws synchronously also frees the key", async () => {
    const g = createPressGuard();
    await expect(
      g.run("copy", () => {
        throw new Error("sync");
      }),
    ).rejects.toThrow("sync");
    expect(g.busy("copy")).toBe(false);
  });
});
