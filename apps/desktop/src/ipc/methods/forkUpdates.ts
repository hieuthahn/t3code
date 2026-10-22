import { DesktopForkUpdateStateSchema } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopForkUpdates from "../../updates/DesktopForkUpdates.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

export const getForkUpdateState = makeIpcMethod({
  channel: IpcChannels.FORK_UPDATE_GET_STATE_CHANNEL,
  payload: Schema.Void,
  result: DesktopForkUpdateStateSchema,
  handler: Effect.fn("desktop.ipc.forkUpdates.getState")(function* () {
    return yield* DesktopForkUpdates.getState;
  }),
});

export const checkForkUpdate = makeIpcMethod({
  channel: IpcChannels.FORK_UPDATE_CHECK_CHANNEL,
  payload: Schema.Void,
  result: DesktopForkUpdateStateSchema,
  handler: Effect.fn("desktop.ipc.forkUpdates.check")(function* () {
    return yield* DesktopForkUpdates.check;
  }),
});

export const applyForkUpdate = makeIpcMethod({
  channel: IpcChannels.FORK_UPDATE_APPLY_CHANNEL,
  payload: Schema.Void,
  result: DesktopForkUpdateStateSchema,
  handler: Effect.fn("desktop.ipc.forkUpdates.apply")(function* () {
    return yield* DesktopForkUpdates.apply;
  }),
});

export const setForkUpdatePaused = makeIpcMethod({
  channel: IpcChannels.FORK_UPDATE_SET_PAUSED_CHANNEL,
  payload: Schema.Boolean,
  result: DesktopForkUpdateStateSchema,
  handler: Effect.fn("desktop.ipc.forkUpdates.setPaused")(function* (paused) {
    return yield* DesktopForkUpdates.setPaused(paused);
  }),
});
