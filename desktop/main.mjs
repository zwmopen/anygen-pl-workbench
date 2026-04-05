import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, shell } from "electron";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

let serverRef = null;
let schedulerRef = null;

app.setName("AnyGen Workbench");
app.setAppUserModelId("com.anygen.workbench");

const dataRoot = path.join(app.getPath("userData"), "data");
process.env.ANYGEN_DATA_DIR = dataRoot;
process.env.HOST = "127.0.0.1";

if (process.argv.includes("--run-scheduled")) {
  const { runScheduledOnce } = await import("../src/app.js");

  try {
    await runScheduledOnce();
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on("second-instance", () => {
  const window = BrowserWindow.getAllWindows()[0];
  if (!window) {
    return;
  }

  if (window.isMinimized()) {
    window.restore();
  }
  window.focus();
});

app.whenReady().then(async () => {
  const port = await findAvailablePort(4318);
  process.env.PORT = String(port);

  const { createServerApp } = await import("../src/app.js");
  const { app: expressApp, scheduler } = await createServerApp();
  schedulerRef = scheduler;

  serverRef = await new Promise((resolve, reject) => {
    const server = expressApp.listen(port, process.env.HOST, () => resolve(server));
    server.once("error", reject);
  });

  const window = new BrowserWindow({
    width: 1460,
    height: 960,
    minWidth: 1180,
    minHeight: 780,
    backgroundColor: "#e7edf6",
    autoHideMenuBar: true,
    title: "AnyGen Workbench",
    icon: path.join(projectRoot, "assets", "AnyGen-Workbench.ico"),
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      spellcheck: false
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    const allowedPrefix = `http://${process.env.HOST}:${port}/`;
    if (!url.startsWith(allowedPrefix)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  await window.loadURL(`http://${process.env.HOST}:${port}/`);

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await window.loadURL(`http://${process.env.HOST}:${port}/`);
    }
  });
});

app.on("window-all-closed", async () => {
  await shutdown();
  app.quit();
});

app.on("before-quit", async () => {
  await shutdown();
});

async function shutdown() {
  if (schedulerRef) {
    await schedulerRef.stop();
    schedulerRef = null;
  }

  if (serverRef) {
    await new Promise((resolve) => serverRef.close(resolve));
    serverRef = null;
  }
}

async function findAvailablePort(startPort) {
  let port = startPort;
  while (port < startPort + 40) {
    const available = await testPort(port);
    if (available) {
      return port;
    }
    port += 1;
  }

  throw new Error("没有找到可用端口。");
}

function testPort(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once("error", () => resolve(false))
      .once("listening", () => tester.close(() => resolve(true)))
      .listen(port, "127.0.0.1");
  });
}
