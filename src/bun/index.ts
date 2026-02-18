import { BrowserWindow, Updater, Utils } from "electrobun/bun";
import { events } from "./events";
import { logger } from "./services/logger-service";
import { configService, createBunRPC } from "./rpc";

const APP_TITLE = "TiDB Desktop";
const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
const PROD_VIEW_URL = "views://mainview/index.html";

let mainWindow: BrowserWindow<any> | null = null;

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

  const rpc = createBunRPC({
    isMaximised: () => Boolean(mainWindow?.isMaximized()),
    maximise: () => {
      mainWindow?.maximize();
    },
    unmaximise: () => {
      mainWindow?.unmaximize();
    },
    readClipboardText: () => Utils.clipboardReadText() ?? "",
  });

  mainWindow = new BrowserWindow({
    title: APP_TITLE,
    url,
    renderer: "cef",
    titleBarStyle: "hidden",
    transparent: false,
    sandbox: false,
    frame: {
      x:
        windowSettings.x !== undefined && windowSettings.x !== -1
          ? windowSettings.x
          : 200,
      y:
        windowSettings.y !== undefined && windowSettings.y !== -1
          ? windowSettings.y
          : 200,
      width: windowSettings.width || 1024,
      height: windowSettings.height || 768,
    },
    rpc,
  });

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
