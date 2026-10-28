import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ElectronApp from "../../electron/ElectronApp.ts";
import * as ElectronPowerSaveBlocker from "../../electron/ElectronPowerSaveBlocker.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { SET_KEEP_AWAKE_STATE_CHANNEL } from "../channels.ts";

const KeepAwakeState = Schema.Struct({
  enabled: Schema.Boolean,
  running: Schema.Boolean,
});

export const installKeepAwake = Effect.fn("desktop.ipc.installKeepAwake")(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  const app = yield* ElectronApp.ElectronApp;
  const blocker = yield* ElectronPowerSaveBlocker.ElectronPowerSaveBlocker;
  const gate = yield* Semaphore.make(1);
  const activeSenders = new Set<number>();
  const watchedSenders = new Set<number>();
  let blockerId: number | null = null;

  const reconcile = gate.withPermits(1)(
    Effect.gen(function* () {
      if (activeSenders.size > 0 && blockerId === null) {
        blockerId = yield* blocker.start("prevent-app-suspension");
      } else if (activeSenders.size === 0 && blockerId !== null) {
        const id = blockerId;
        blockerId = null;
        yield* blocker.stop(id);
      }
    }),
  );
  const releaseAll = Effect.suspend(() => {
    activeSenders.clear();
    return reconcile;
  });
  const forget = (senderId: number) => {
    watchedSenders.delete(senderId);
    activeSenders.delete(senderId);
    Effect.runFork(reconcile);
  };
  const watch = (senderId: number) => {
    if (watchedSenders.has(senderId)) return;
    watchedSenders.add(senderId);
    const contents = Electron.webContents.fromId(senderId);
    contents?.once("destroyed", () => forget(senderId));
    contents?.once("render-process-gone", () => forget(senderId));
  };

  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: SET_KEEP_AWAKE_STATE_CHANNEL,
      payload: KeepAwakeState,
      result: Schema.Void,
      handler: (state, event) =>
        Effect.suspend(() => {
          const senderId = event?.sender.id ?? 0;
          if (state.enabled && state.running) {
            watch(senderId);
            activeSenders.add(senderId);
          } else {
            activeSenders.delete(senderId);
          }
          return reconcile;
        }),
    }),
  );
  yield* app.on("before-quit", () => Effect.runFork(releaseAll));
  yield* Effect.addFinalizer(() => releaseAll);
});
