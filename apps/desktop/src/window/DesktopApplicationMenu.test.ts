import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import type * as Electron from "electron";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as ElectronMenu from "../electron/ElectronMenu.ts";
import * as DesktopApplicationMenu from "./DesktopApplicationMenu.ts";
import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopUpdates from "../updates/DesktopUpdates.ts";
import * as DesktopWindow from "./DesktopWindow.ts";

const environmentInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "linux",
  processArch: "arm64",
  appVersion: "1.2.3",
  appPath: "/repo",
  isPackaged: false,
  resourcesPath: "/repo/resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

const layerElectronApp = Layer.succeed(ElectronApp.ElectronApp, {
  metadata: Effect.die("unexpected metadata read"),
  name: Effect.succeed("T3 Code"),
  systemLocale: Effect.succeed("en-US"),
  whenReady: Effect.void,
  requestSingleInstanceLock: Effect.succeed(true),
  quit: Effect.void,
  exit: () => Effect.void,
  relaunch: () => Effect.void,
  setPath: () => Effect.void,
  setName: () => Effect.void,
  setAboutPanelOptions: () => Effect.void,
  setAppUserModelId: () => Effect.void,
  getAppMetrics: Effect.succeed([]),
  setAsDefaultProtocolClient: () => Effect.succeed(true),
  setDesktopName: () => Effect.void,
  setDockIcon: () => Effect.void,
  appendCommandLineSwitch: () => Effect.void,
  onBeforeQuitForUpdate: () => Effect.void,
  removeCommandLineSwitch: () => Effect.void,
  on: () => Effect.void,
} satisfies ElectronApp.ElectronApp["Service"]);

const layerElectronDialog = (shownMessage?: Deferred.Deferred<Electron.MessageBoxOptions>) =>
  Layer.succeed(ElectronDialog.ElectronDialog, {
    pickFolder: () => Effect.succeedNone,
    pickFiles: () => Effect.succeed([]),
    showMessageBox: (options) =>
      (shownMessage ? Deferred.succeed(shownMessage, options) : Effect.void).pipe(
        Effect.as({ response: 1, checkboxChecked: false }),
      ),
    showErrorBox: () => Effect.void,
  } satisfies ElectronDialog.ElectronDialog["Service"]);

const layerDesktopUpdates = Layer.succeed(DesktopUpdates.DesktopUpdates, {
  getState: Effect.die("unexpected getState"),
  isActionActive: Effect.succeed(false),
  isInstallActive: Effect.succeed(false),
  subscribe: Effect.die("unexpected subscribe"),
  emitState: Effect.void,
  disabledReason: Effect.succeedNone,
  configure: Effect.void,
  setChannel: () => Effect.die("unexpected setChannel"),
  check: () => Effect.die("unexpected check"),
  download: Effect.die("unexpected download"),
  install: Effect.die("unexpected install"),
  installPrepared: () => Effect.die("unexpected installPrepared"),
} satisfies DesktopUpdates.DesktopUpdates["Service"]);

const layerDesktopWindow = (selectedAction: Deferred.Deferred<string>) =>
  Layer.succeed(DesktopWindow.DesktopWindow, {
    createMain: Effect.die("unexpected createMain"),
    ensureMain: Effect.die("unexpected ensureMain"),
    revealOrCreateMain: Effect.die("unexpected revealOrCreateMain"),
    activate: Effect.void,
    createMainIfBackendReady: Effect.void,
    showConnectingSplash: Effect.void,
    handleBackendReady: () => Effect.void,
    handleBackendNotReady: Effect.void,
    flushMainWindowBounds: Effect.void,
    prepareCaptureReveal: Effect.void,
    dispatchMenuAction: (action) => Deferred.succeed(selectedAction, action).pipe(Effect.asVoid),
    dispatchSnapShotEvent: () => Effect.void,
    zoomMain: (direction) =>
      Deferred.succeed(selectedAction, `zoom-${direction}`).pipe(Effect.asVoid),
    runMainContentsCommand: (command) =>
      Deferred.succeed(selectedAction, `main-${command}`).pipe(Effect.asVoid),
    syncAppearance: Effect.void,
  } satisfies DesktopWindow.DesktopWindow["Service"]);

const layerElectronMenu = (
  applicationMenuTemplate: Deferred.Deferred<readonly Electron.MenuItemConstructorOptions[]>,
) =>
  Layer.succeed(ElectronMenu.ElectronMenu, {
    setApplicationMenu: (template) =>
      Deferred.succeed(applicationMenuTemplate, template).pipe(Effect.asVoid),
    popupTemplate: () => Effect.void,
    showContextMenu: () => Effect.succeedNone,
  } satisfies ElectronMenu.ElectronMenu["Service"]);

const configureMenu = (
  selectedAction: Deferred.Deferred<string>,
  applicationMenuTemplate: Deferred.Deferred<readonly Electron.MenuItemConstructorOptions[]>,
  environment: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  options: {
    readonly configEnv?: Readonly<Record<string, string>>;
    readonly shownMessage?: Deferred.Deferred<Electron.MessageBoxOptions>;
  } = {},
) =>
  Effect.gen(function* () {
    const menu = yield* DesktopApplicationMenu.DesktopApplicationMenu;
    yield* menu.configure;
  }).pipe(
    Effect.provide(
      DesktopApplicationMenu.layer.pipe(
        Layer.provideMerge(layerElectronMenu(applicationMenuTemplate)),
        Layer.provideMerge(layerDesktopWindow(selectedAction)),
        Layer.provideMerge(layerDesktopUpdates),
        Layer.provideMerge(layerElectronDialog(options.shownMessage)),
        Layer.provideMerge(layerElectronApp),
        Layer.provideMerge(
          DesktopEnvironment.layer({ ...environmentInput, ...environment }).pipe(
            Layer.provide(Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({}))),
          ),
        ),
        Layer.provideMerge(
          Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest(options.configEnv ?? {})),
        ),
      ),
    ),
  );

describe("DesktopApplicationMenu", () => {
  it.effect("leaves the accelerator to Chromium instead of injecting a paste", () =>
    Effect.gen(function* () {
      const selectedAction = yield* Deferred.make<string>();
      const applicationMenuTemplate =
        yield* Deferred.make<readonly Electron.MenuItemConstructorOptions[]>();

      yield* configureMenu(selectedAction, applicationMenuTemplate);

      const template = yield* Deferred.await(applicationMenuTemplate);
      const editMenu = template.find((item) => item.label === "Edit");
      if (!Array.isArray(editMenu?.submenu)) {
        throw new Error("Expected Edit menu submenu to be an array.");
      }
      const pasteAsTextItem = editMenu.submenu.find((item) => item.label === "Paste as Text");
      if (typeof pasteAsTextItem?.click !== "function") {
        throw new Error("Expected Paste as Text menu item to have a click handler.");
      }

      pasteAsTextItem.click(
        {} as Electron.MenuItem,
        {} as Electron.BrowserWindow,
        {
          triggeredByAccelerator: true,
        } as unknown as KeyboardEvent,
      );
      assert.isFalse(yield* Deferred.isDone(selectedAction));
    }),
  );

  it.effect("registers macOS command-plus once and routes it through main-window zoom", () =>
    Effect.gen(function* () {
      const selectedAction = yield* Deferred.make<string>();
      const applicationMenuTemplate =
        yield* Deferred.make<readonly Electron.MenuItemConstructorOptions[]>();

      yield* configureMenu(selectedAction, applicationMenuTemplate, { platform: "darwin" });

      const template = yield* Deferred.await(applicationMenuTemplate);
      const viewMenu = template.find((item) => item.label === "View");
      assert.isDefined(viewMenu);
      if (!Array.isArray(viewMenu.submenu)) {
        throw new Error("Expected View menu submenu to be an array.");
      }

      assert.isUndefined(
        viewMenu.submenu.find((item) =>
          ["zoom", "reload", "devtools"].some((role) => item.role?.toLowerCase().includes(role)),
        ),
      );

      const shiftedEqual = viewMenu.submenu.filter(
        (item) => item.accelerator === "CmdOrCtrl+Shift+=",
      );
      assert.lengthOf(shiftedEqual, 1);
      assert.lengthOf(
        viewMenu.submenu.filter((item) => item.accelerator === "CmdOrCtrl+numadd"),
        1,
      );
      const zoomIn = shiftedEqual[0];
      assert.isDefined(zoomIn);
      assert.isFalse(zoomIn.visible);
      if (typeof zoomIn.click !== "function") {
        throw new Error("Expected Zoom In menu item to have a click handler.");
      }

      zoomIn.click({} as Electron.MenuItem, {} as Electron.BrowserWindow, {} as KeyboardEvent);
      assert.equal(yield* Deferred.await(selectedAction), "zoom-in");
    }),
  );

  it.effect("reloads the main window even while a browser page has focus", () =>
    Effect.gen(function* () {
      const selectedAction = yield* Deferred.make<string>();
      const applicationMenuTemplate =
        yield* Deferred.make<readonly Electron.MenuItemConstructorOptions[]>();

      yield* configureMenu(selectedAction, applicationMenuTemplate);

      const template = yield* Deferred.await(applicationMenuTemplate);
      const viewMenu = template.find((item) => item.label === "View");
      if (!Array.isArray(viewMenu?.submenu)) {
        throw new Error("Expected View menu submenu to be an array.");
      }
      const reload = viewMenu.submenu.find((item) => item.label === "Reload");
      assert.equal(reload?.accelerator, "CmdOrCtrl+R");
      if (typeof reload?.click !== "function") {
        throw new Error("Expected Reload menu item to have a click handler.");
      }

      reload.click({} as Electron.MenuItem, {} as Electron.BrowserWindow, {} as KeyboardEvent);
      assert.equal(yield* Deferred.await(selectedAction), "main-reload");
    }),
  );

  it.effect("checks through the fork updater instead of the upstream updater", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "fork-menu-" });
      const updaterPath = path.join(directory, "t3-update");
      const recordPath = path.join(directory, "record.log");
      const status = {
        head: "4a66c6edd2",
        branch: "feat/shared-history-continuation",
        track: "preview",
        paused: false,
        activeRuns: 0,
        applyRunning: false,
        check: {
          checkedAt: "2026-10-22T06:40:00Z",
          head: "4a66c6edd2",
          upstreamHead: "a0c623abd8",
          newCommits: 0,
          overlapFiles: [],
          conflictFiles: [],
          riskyFiles: [],
          baseTag: "v0.1.2-preview.20261022.3511",
          targetTag: "v0.1.2-preview.20261022.3511",
          version: "0.1.2-preview.20261022.3511+fork.4a66c6edd2",
          updateAvailable: false,
        },
        lastRun: null,
      };
      yield* fileSystem.writeFileString(
        updaterPath,
        `#!/bin/sh\necho "$@" >> ${JSON.stringify(recordPath)}\nprintf '%s\\n' ${JSON.stringify(JSON.stringify(status))}\n`,
      );
      yield* fileSystem.chmod(updaterPath, 0o755);
      const selectedAction = yield* Deferred.make<string>();
      const applicationMenuTemplate =
        yield* Deferred.make<readonly Electron.MenuItemConstructorOptions[]>();
      const shownMessage = yield* Deferred.make<Electron.MessageBoxOptions>();

      yield* configureMenu(
        selectedAction,
        applicationMenuTemplate,
        { platform: "darwin" },
        { configEnv: { T3CODE_FORK_UPDATER: updaterPath }, shownMessage },
      );

      const template = yield* Deferred.await(applicationMenuTemplate);
      const appMenu = template[0];
      if (!Array.isArray(appMenu?.submenu)) {
        throw new Error("Expected the app menu submenu to be an array.");
      }
      const checkItem = appMenu.submenu.find((item) => item.label === "Check for Updates...");
      if (typeof checkItem?.click !== "function") {
        throw new Error("Expected Check for Updates to have a click handler.");
      }
      checkItem.click(
        {} as Electron.MenuItem,
        {} as Electron.BrowserWindow,
        {} as unknown as KeyboardEvent,
      );

      const message = yield* Deferred.await(shownMessage);
      assert.equal(message.title, "You're up to date!");
      assert.equal(message.message, "T3 Code is on v0.1.2-preview.20261022.3511.");
      assert.include(yield* fileSystem.readFileString(recordPath), "check --json");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
