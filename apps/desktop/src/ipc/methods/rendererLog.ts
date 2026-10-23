import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopRendererLog from "../../telemetry/DesktopRendererLog.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

const RendererLogEvent = Schema.Struct({
  level: Schema.Literals(["warning", "error"]),
  source: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  message: Schema.String.check(Schema.isMaxLength(8_192)),
});

export const logRendererEvent = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.LOG_RENDERER_EVENT_CHANNEL,
  payload: RendererLogEvent,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.rendererLog.append")(function* (event, ipcEvent) {
    const rendererLog = yield* DesktopRendererLog.DesktopRendererLog;
    yield* rendererLog.append(event, ipcEvent?.sender.id ?? null);
  }),
});
