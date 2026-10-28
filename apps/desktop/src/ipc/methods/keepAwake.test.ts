import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import { beforeEach, expect, vi } from "vite-plus/test";
import { it } from "@effect/vitest";

const native = vi.hoisted(() => ({
  appListeners: new Map<string, () => void>(),
  webContentsListeners: new Map<string, () => void>(),
}));
vi.mock("electron", () => ({
  app: {
    on: (event: string, listener: () => void) => native.appListeners.set(event, listener),
    removeListener: (event: string) => native.appListeners.delete(event),
  },
  webContents: {
    fromId: (id: number) => ({
      once: (event: string, listener: () => void) =>
        native.webContentsListeners.set(`${id}:${event}`, listener),
    }),
  },
}));

import * as ElectronApp from "../../electron/ElectronApp.ts";
import * as ElectronPowerSaveBlocker from "../../electron/ElectronPowerSaveBlocker.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { installKeepAwake } from "./keepAwake.ts";

const CHANNEL = "desktop:set-keep-awake-state";

beforeEach(() => {
  native.appListeners.clear();
  native.webContentsListeners.clear();
});

const harness = <A>(
  body: (input: {
    readonly send: (senderId: number, state: unknown) => Effect.Effect<void>;
    readonly held: () => ReadonlyArray<number>;
    readonly starts: ReadonlyArray<string>;
  }) => Effect.Effect<A>,
) =>
  Effect.gen(function* () {
    const handlers = new Map<string, DesktopIpc.DesktopIpcHandleListener>();
    const active = new Set<number>();
    const starts: string[] = [];
    let nextId = 100;
    const blocker = Layer.succeed(
      ElectronPowerSaveBlocker.ElectronPowerSaveBlocker,
      ElectronPowerSaveBlocker.ElectronPowerSaveBlocker.of({
        start: (type) =>
          Effect.sync(() => {
            starts.push(type);
            active.add(++nextId);
            return nextId;
          }),
        stop: (id) =>
          Effect.sync(() => {
            active.delete(id);
          }),
      }),
    );
    const ipc = DesktopIpc.layer({
      handle: (channel, handler) => {
        handlers.set(channel, handler);
      },
      removeHandler: (channel) => {
        handlers.delete(channel);
      },
      on: vi.fn(),
      removeAllListeners: vi.fn(),
    });
    const result = yield* Effect.scoped(
      Effect.gen(function* () {
        yield* installKeepAwake();
        return yield* body({
          send: (senderId, state) =>
            Effect.promise(async () => {
              await handlers.get(CHANNEL)!({ sender: { id: senderId } }, state);
            }),
          held: () => [...active],
          starts,
        });
      }),
    ).pipe(Effect.provide([ElectronApp.layer, ipc, blocker]));
    expect(active.size).toBe(0);
    expect(native.appListeners.size).toBe(0);
    expect(handlers.size).toBe(0);
    return result;
  });

const on = { enabled: true, running: true };

it.effect("holds no blocker while the setting is off", () =>
  harness(({ send, held, starts }) =>
    Effect.gen(function* () {
      yield* send(1, { enabled: false, running: true });
      expect(held()).toEqual([]);
      expect(starts).toEqual([]);
    }),
  ),
);

it.effect("holds no blocker while the setting is on and nothing runs", () =>
  harness(({ send, held }) =>
    Effect.gen(function* () {
      yield* send(1, { enabled: true, running: false });
      expect(held()).toEqual([]);
    }),
  ),
);

it.effect(
  "starts a prevent-app-suspension blocker for an active run and releases it when it ends",
  () =>
    harness(({ send, held, starts }) =>
      Effect.gen(function* () {
        yield* send(1, on);
        expect(starts).toEqual(["prevent-app-suspension"]);
        expect(held()).toHaveLength(1);
        yield* send(1, { enabled: true, running: false });
        expect(held()).toEqual([]);
      }),
    ),
);

it.effect("releases when the setting turns off mid-run", () =>
  harness(({ send, held }) =>
    Effect.gen(function* () {
      yield* send(1, on);
      yield* send(1, { enabled: false, running: true });
      expect(held()).toEqual([]);
    }),
  ),
);

it.effect("keeps a single blocker across repeated reports, toggles, and rapid start and stop", () =>
  harness(({ send, held, starts }) =>
    Effect.gen(function* () {
      yield* send(1, on);
      yield* send(1, on);
      yield* send(2, on);
      expect(held()).toHaveLength(1);
      expect(starts).toHaveLength(1);
      for (let i = 0; i < 5; i += 1) {
        yield* send(1, { enabled: false, running: true });
        yield* send(2, { enabled: false, running: true });
        yield* send(1, on);
        yield* send(2, on);
        expect(held().length).toBeLessThanOrEqual(1);
      }
      expect(held()).toHaveLength(1);
      yield* Effect.all([send(1, on), send(1, { enabled: true, running: false }), send(1, on)], {
        concurrency: "unbounded",
      });
      expect(held().length).toBeLessThanOrEqual(1);
    }),
  ),
);

it.effect("keeps the blocker until every active window stops", () =>
  harness(({ send, held }) =>
    Effect.gen(function* () {
      yield* send(1, on);
      yield* send(2, on);
      yield* send(1, { enabled: true, running: false });
      expect(held()).toHaveLength(1);
      yield* send(2, { enabled: true, running: false });
      expect(held()).toEqual([]);
    }),
  ),
);

it.effect("releases when the reporting window is destroyed", () =>
  harness(({ send, held }) =>
    Effect.gen(function* () {
      yield* send(1, on);
      native.webContentsListeners.get("1:destroyed")!();
      yield* Effect.yieldNow;
      expect(held()).toEqual([]);
    }),
  ),
);

it.effect("releases when the reporting renderer crashes, and holds again once it reports", () =>
  harness(({ send, held }) =>
    Effect.gen(function* () {
      yield* send(1, on);
      native.webContentsListeners.get("1:render-process-gone")!();
      yield* Effect.yieldNow;
      expect(held()).toEqual([]);
      yield* send(1, on);
      expect(held()).toHaveLength(1);
    }),
  ),
);

it.effect("releases on before-quit and on disposal", () =>
  harness(({ send, held }) =>
    Effect.gen(function* () {
      yield* send(1, on);
      native.appListeners.get("before-quit")!();
      yield* Effect.yieldNow;
      expect(held()).toEqual([]);
      yield* send(1, on);
      expect(held()).toHaveLength(1);
    }),
  ),
);

it.effect("rejects a malformed state without changing the blocker", () =>
  harness(({ send, held }) =>
    Effect.gen(function* () {
      yield* send(1, on);
      const exit = yield* Effect.exit(send(1, { enabled: "yes", running: true }));
      expect(Exit.isFailure(exit)).toBe(true);
      expect(held()).toHaveLength(1);
    }),
  ),
);
