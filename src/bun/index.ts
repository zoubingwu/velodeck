import { dirname } from "node:path";
import { BrowserWindow, Updater, Utils } from "electrobun/bun";
import { events } from "./events";
import { configService, createBunRPC } from "./rpc";
import { logger } from "./services/logger-service";

const APP_TITLE = "TiDB Desktop";
const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
const PROD_VIEW_URL = "views://mainview/index.html";
const DEFAULT_WINDOW_X = 200;
const DEFAULT_WINDOW_Y = 200;
const MIN_VISIBLE_X = 20;
const MIN_VISIBLE_Y = 60;
const MIN_WINDOW_WIDTH = 800;
const MIN_WINDOW_HEIGHT = 560;

let mainWindow: BrowserWindow<any> | null = null;

function normalizeCoordinate(
  value: number | undefined,
  fallback: number,
  min: number,
): number {
  if (value === undefined || value === -1 || !Number.isFinite(value)) {
    return fallback;
  }
  return value < min ? fallback : value;
}

function normalizeSize(
  value: number | undefined,
  fallback: number,
  min: number,
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return value < min ? fallback : value;
}

async function getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();
  if (channel === "dev") {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      logger.info(`HMR enabled: ${DEV_SERVER_URL}`);
      return DEV_SERVER_URL;
    } catch {
      logger.info("Vite dev server not running; fallback to bundled view");
    }
  }

  return PROD_VIEW_URL;
}

async function createMainWindow(): Promise<void> {
  if (mainWindow) {
    mainWindow.focus();
    return;
  }

  const windowSettings = configService.getWindowSettings();
  const url = await getMainViewUrl();
  const frameX = normalizeCoordinate(
    windowSettings.x,
    DEFAULT_WINDOW_X,
    MIN_VISIBLE_X,
  );
  const frameY = normalizeCoordinate(
    windowSettings.y,
    DEFAULT_WINDOW_Y,
    MIN_VISIBLE_Y,
  );
  const frameWidth = normalizeSize(
    windowSettings.width,
    1024,
    MIN_WINDOW_WIDTH,
  );
  const frameHeight = normalizeSize(
    windowSettings.height,
    768,
    MIN_WINDOW_HEIGHT,
  );

  const rpc = createBunRPC({
    isMaximised: () => Boolean(mainWindow?.isMaximized()),
    maximise: () => {
      mainWindow?.maximize();
    },
    unmaximise: () => {
      mainWindow?.unmaximize();
    },
    readClipboardText: () => Utils.clipboardReadText() ?? "",
    pickSQLiteFile: async (currentPath: string) => {
      const startingFolder = currentPath.trim()
        ? dirname(currentPath.trim())
        : "~/";
      const picked = await Utils.openFileDialog({
        startingFolder,
        allowedFileTypes: "sqlite,db,db3",
        canChooseFiles: true,
        canChooseDirectory: false,
        allowsMultipleSelection: false,
      });
      return picked[0] || "";
    },
  });

  mainWindow = new BrowserWindow({
    title: APP_TITLE,
    url,
    titleBarStyle: "default",
    styleMask: {
      Borderless: false,
      Titled: true,
      Closable: true,
      Miniaturizable: true,
      Resizable: true,
      UnifiedTitleAndToolbar: false,
      FullScreen: false,
      FullSizeContentView: false,
      UtilityWindow: false,
      DocModalWindow: false,
      NonactivatingPanel: false,
      HUDWindow: false,
    },
    frame: {
      x: frameX,
      y: frameY,
      width: frameWidth,
      height: frameHeight,
    },
    rpc,
  });

  logger.info(
    `[window-debug] style=default frame=(${frameX},${frameY},${frameWidth},${frameHeight})`,
  );

  events.attachWindow(mainWindow);

  if (windowSettings.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.on("close", () => {
    if (!mainWindow) {
      return;
    }

    const frame = mainWindow.getFrame();
    configService.saveWindowSettings({
      width: frame.width,
      height: frame.height,
      x: frame.x,
      y: frame.y,
      isMaximized: mainWindow.isMaximized(),
    });
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    Utils.quit();
  });

  logger.info("Electrobun window created");
}

await createMainWindow();
