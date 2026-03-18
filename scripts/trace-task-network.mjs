import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const taskUrl = process.argv[2];
const outputDir = "D:\\AICode\\anygen-pL\\data\\runtime";
const debuggingPort = 9333;

async function waitForPageDebugger() {
  const versionUrl = `http://127.0.0.1:${debuggingPort}/json`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const pages = await fetch(versionUrl).then((response) => response.json());
      const page = pages.find((item) => item.type === "page");
      if (page?.webSocketDebuggerUrl) {
        return page.webSocketDebuggerUrl;
      }
    } catch {
      // Browser not ready yet.
    }
    await delay(500);
  }
  throw new Error("Timed out waiting for Chrome DevTools.");
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  return result?.result?.value ?? null;
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function trimPayload(value) {
  const text = String(value || "");
  return text.length > 8000 ? `${text.slice(0, 8000)}...[truncated]` : text;
}

async function killDebugBrowsers(port) {
  try {
    const { execFile } = await import("node:child_process");
    await new Promise((resolve) => {
      execFile("powershell", [
        "-NoProfile",
        "-Command",
        `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*--remote-debugging-port=${port}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
      ], () => resolve());
    });
  } catch {
    // Best effort cleanup.
  }
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });

    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const handler = this.pending.get(message.id);
        if (!handler) {
          return;
        }
        this.pending.delete(message.id);
        if (message.error) {
          handler.reject(new Error(message.error.message || "CDP error"));
          return;
        }
        handler.resolve(message.result);
        return;
      }

      if (message.method) {
        const listeners = this.handlers.get(message.method) || [];
        for (const listener of listeners) {
          listener(message.params || {});
        }
      }
    });
  }

  on(method, listener) {
    const listeners = this.handlers.get(method) || [];
    listeners.push(listener);
    this.handlers.set(method, listeners);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  async close() {
    if (!this.socket) {
      return;
    }
    this.socket.close();
    await delay(250);
  }
}

await main();

async function main() {
  const browserPath = await exists(chromePath) ? chromePath : edgePath;

  if (!taskUrl) {
    console.error("Usage: node scripts/trace-task-network.mjs <task-url>");
    process.exit(1);
  }

  if (!browserPath || !await exists(browserPath)) {
    console.error("Chrome/Edge not found.");
    process.exit(1);
  }

  await fs.mkdir(outputDir, { recursive: true });

  const log = {
    taskUrl,
    browserPath,
    startedAt: new Date().toISOString(),
    requests: [],
    responses: [],
    webSockets: [],
    console: [],
    runtime: {}
  };

  const browser = spawn(browserPath, [
    `--remote-debugging-port=${debuggingPort}`,
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--user-data-dir=D:\\AICode\\anygen-pL\\data\\runtime\\trace-profile",
    "about:blank"
  ], {
    stdio: "ignore",
    detached: true
  });
  browser.unref();

  try {
    const pageWsUrl = await waitForPageDebugger();
    const client = new CdpClient(pageWsUrl);
    await client.connect();

    client.on("Network.requestWillBeSent", (params) => {
      log.requests.push({
        requestId: params.requestId,
        url: params.request.url,
        method: params.request.method,
        headers: params.request.headers,
        postData: params.request.postData || ""
      });
    });

    client.on("Network.responseReceived", (params) => {
      log.responses.push({
        requestId: params.requestId,
        url: params.response.url,
        status: params.response.status,
        mimeType: params.response.mimeType,
        headers: params.response.headers
      });
    });

    client.on("Network.webSocketCreated", (params) => {
      log.webSockets.push({
        type: "created",
        requestId: params.requestId,
        url: params.url
      });
    });

    client.on("Network.webSocketFrameReceived", (params) => {
      log.webSockets.push({
        type: "received",
        requestId: params.requestId,
        opcode: params.response.opcode,
        payloadData: trimPayload(params.response.payloadData)
      });
    });

    client.on("Network.webSocketFrameSent", (params) => {
      log.webSockets.push({
        type: "sent",
        requestId: params.requestId,
        opcode: params.response.opcode,
        payloadData: trimPayload(params.response.payloadData)
      });
    });

    client.on("Runtime.consoleAPICalled", (params) => {
      log.console.push({
        type: params.type,
        args: params.args?.map((item) => item.value ?? item.description ?? null) || []
      });
    });

    await client.send("Page.enable");
    await client.send("Network.enable");
    await client.send("Runtime.enable");

    await client.send("Page.navigate", { url: taskUrl });
    await delay(18000);

    log.runtime.documentTitle = await evaluate(client, "document.title");
    log.runtime.href = await evaluate(client, "location.href");
    log.runtime.localStorageKeys = await evaluate(client, "Object.keys(localStorage)");
    log.runtime.sessionStorageKeys = await evaluate(client, "Object.keys(sessionStorage)");
    log.runtime.windowKeys = await evaluate(client, "Object.keys(window).filter((key) => /task|export|download|file|doc|image|result/i.test(key)).slice(0, 200)");
    log.runtime.bodyTextPreview = await evaluate(client, "document.body.innerText.slice(0, 4000)");
    log.runtime.performanceEntries = await evaluate(client, "performance.getEntriesByType('resource').map((item) => ({name:item.name, initiatorType:item.initiatorType})).slice(-200)");

    const requestBodies = [];
    for (const response of log.responses) {
      if (!/task|export|download|file|anygen|frontier/i.test(response.url)) {
        continue;
      }
      try {
        const result = await client.send("Network.getResponseBody", { requestId: response.requestId });
        requestBodies.push({
          url: response.url,
          status: response.status,
          body: trimPayload(result.body)
        });
      } catch {
        // Some bodies are not available via CDP.
      }
    }
    log.runtime.responseBodies = requestBodies;

    await fs.writeFile(path.join(outputDir, "trace-task-network.json"), JSON.stringify(log, null, 2), "utf8");
    console.log(JSON.stringify({
      output: path.join(outputDir, "trace-task-network.json"),
      requests: log.requests.length,
      responses: log.responses.length,
      webSockets: log.webSockets.length
    }, null, 2));

    await client.close();
  } finally {
    await killDebugBrowsers(debuggingPort);
  }
}
