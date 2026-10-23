import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { makeRotatingLogFileWriter } from "../app/DesktopObservability.ts";

export const RENDERER_LOG_FILE_NAME = "renderer-events.ndjson";

export interface RendererLogEvent {
  readonly level: "warning" | "error";
  readonly source: string;
  readonly message: string;
}

export class DesktopRendererLog extends Context.Service<
  DesktopRendererLog,
  {
    readonly append: (event: RendererLogEvent, webContentsId: number | null) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/telemetry/DesktopRendererLog") {}

const RendererLogRecord = Schema.Struct({
  version: Schema.Literal(1),
  timestamp: Schema.String,
  level: Schema.Literals(["warning", "error"]),
  source: Schema.String,
  message: Schema.String,
  webContentsId: Schema.NullOr(Schema.Number),
});

const encodeRendererLogRecord = Schema.encodeEffect(Schema.fromJsonString(RendererLogRecord));

const make = Effect.fn("DesktopRendererLog.make")(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const path = yield* Path.Path;
  const writer = yield* makeRotatingLogFileWriter({
    filePath: path.join(environment.logDir, RENDERER_LOG_FILE_NAME),
    maxBytes: 1024 * 1024,
    maxFiles: 3,
  }).pipe(
    Effect.catch(() =>
      Effect.logWarning("Renderer event log could not be opened.").pipe(
        Effect.as({ writeText: (_chunk: string) => Effect.void }),
      ),
    ),
  );

  return DesktopRendererLog.of({
    append: Effect.fn("DesktopRendererLog.append")(function* (event, webContentsId) {
      const line = yield* encodeRendererLogRecord({
        version: 1,
        timestamp: DateTime.formatIso(yield* DateTime.now),
        level: event.level,
        source: event.source,
        message: event.message,
        webContentsId,
      });
      yield* writer.writeText(`${line}\n`);
    }, Effect.ignore),
  });
});

export const layer = Layer.effect(DesktopRendererLog, make());
