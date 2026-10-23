import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { vi } from "vite-plus/test";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as DesktopRendererLog from "../../telemetry/DesktopRendererLog.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { LOG_RENDERER_EVENT_CHANNEL } from "../channels.ts";
import { logRendererEvent } from "./rendererLog.ts";

it.effect("appends valid renderer events to the log file and rejects malformed ones", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const logDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-renderer-log-" });
    const filePath = `${logDir}/${DesktopRendererLog.RENDERER_LOG_FILE_NAME}`;
    const handlers = new Map<string, DesktopIpc.DesktopIpcHandleListener>();
    const layer = Layer.mergeAll(
      DesktopIpc.layer({
        handle: (channel, handler) => {
          handlers.set(channel, handler);
        },
        removeHandler: (channel) => {
          handlers.delete(channel);
        },
        on: vi.fn(),
        removeAllListeners: vi.fn(),
      }),
      DesktopRendererLog.layer.pipe(
        Layer.provide(
          Layer.succeed(
            DesktopEnvironment.DesktopEnvironment,
            DesktopEnvironment.DesktopEnvironment.of({
              logDir,
            } as DesktopEnvironment.DesktopEnvironment["Service"]),
          ),
        ),
      ),
    );

    yield* Effect.scoped(
      Effect.gen(function* () {
        const ipc = yield* DesktopIpc.DesktopIpc;
        yield* ipc.handle(logRendererEvent);
        const handler = handlers.get(LOG_RENDERER_EVENT_CHANNEL)!;
        const event = { sender: { id: 3 } };
        for (const invalid of [
          { level: "info", source: "toast", message: "hello" },
          { level: "error", source: "", message: "hello" },
          { level: "error", source: "s".repeat(65), message: "hello" },
          { level: "error", source: "toast", message: "m".repeat(8_193) },
          { level: "error", source: "toast" },
        ]) {
          yield* Effect.promise(() =>
            Promise.resolve(handler(event, invalid)).then(
              () => assert.fail(`accepted ${JSON.stringify(invalid)}`),
              () => undefined,
            ),
          );
        }
        assert.isFalse(yield* fileSystem.exists(filePath));

        yield* Effect.promise(() =>
          Promise.resolve(
            handler(event, { level: "warning", source: "toast", message: "Disk full\nRetry" }),
          ),
        );
        yield* Effect.promise(() =>
          Promise.resolve(handler(event, { level: "error", source: "toast", message: "Boom" })),
        );
      }),
    ).pipe(Effect.provide(layer));

    const lines = (yield* fileSystem.readFileString(filePath)).trimEnd().split("\n");
    assert.deepEqual(
      lines.map((line) => JSON.parse(line)),
      [
        {
          version: 1,
          timestamp: "1970-01-01T00:00:00.000Z",
          level: "warning",
          source: "toast",
          message: "Disk full\nRetry",
          webContentsId: 3,
        },
        {
          version: 1,
          timestamp: "1970-01-01T00:00:00.000Z",
          level: "error",
          source: "toast",
          message: "Boom",
          webContentsId: 3,
        },
      ],
    );
    assert.equal(handlers.size, 0);
  }).pipe(Effect.provide(NodeServices.layer)),
);
