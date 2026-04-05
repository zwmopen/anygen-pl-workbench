import express from "express";
import multer from "multer";
import os from "node:os";
import path from "node:path";
import { existsSync, promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { AnyGenClient } from "./services/anygen-client.js";
import { ConfigStore } from "./services/config-store.js";
import { JobService } from "./services/job-service.js";
import { SchedulerService } from "./services/scheduler.js";

const execFileAsync = promisify(execFile);
const upload = multer({ storage: multer.memoryStorage() });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const host = process.env.HOST || "127.0.0.1";
const port = Number.parseInt(process.env.PORT || "4318", 10);

let singleton = null;

export async function createServerApp() {
  if (singleton) {
    return singleton;
  }

  const configStore = new ConfigStore();
  await configStore.init();

  const anygenClient = new AnyGenClient();
  const jobService = new JobService({ configStore, anygenClient });
  await jobService.init();

  const scheduler = new SchedulerService({ configStore, jobService, projectRoot });
  const initialConfig = await configStore.getConfig();
  await scheduler.applyConfig(initialConfig);

  const app = express();
  app.use(express.json({ limit: "20mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(projectRoot, "public")));

  app.get("/api/config", async (_request, response) => {
    response.json(await configStore.getConfig());
  });

  app.post("/api/config", async (request, response, next) => {
    try {
      const saved = await configStore.updateConfig(request.body || {});
      await scheduler.applyConfig(saved);
      response.json(saved);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/history", async (_request, response) => {
    response.json(await configStore.getHistory());
  });

  app.get("/api/system/diagnostics", async (_request, response, next) => {
    try {
      response.json(await buildDiagnostics(configStore));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/system/pick-folder", async (request, response, next) => {
    try {
      const selectedPath = await openFolderDialog("选择文件夹", request.body?.initialPath || "");
      response.json({ path: selectedPath || "" });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/system/pick-file", async (request, response, next) => {
    try {
      const selectedPath = await openFileDialog(
        request.body?.filter || "所有文件|*.*",
        request.body?.initialPath || ""
      );
      response.json({ path: selectedPath || "" });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/system/open-path", async (request, response, next) => {
    try {
      const targetPath = String(request.body?.path || "").trim();
      if (!targetPath) {
        throw new Error("缺少要打开的路径。");
      }
      await openLocalPath(targetPath);
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/system/open-location", async (request, response, next) => {
    try {
      const key = String(request.body?.key || "").trim();
      const targetPath = await resolveAppLocation(configStore, key);
      if (!targetPath) {
        throw new Error("没有可打开的位置。");
      }
      await openLocalPath(targetPath);
      response.json({ ok: true, path: targetPath });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/manual/run", upload.array("referenceFiles"), async (request, response, next) => {
    try {
      const result = await jobService.runManualJob({
        name: request.body.name,
        prompt: request.body.prompt,
        operation: request.body.operation,
        outputDirectory: request.body.outputDirectory,
        referenceDirectory: request.body.referenceDirectory,
        uploadedFiles: (request.files || []).map((file) => ({
          sourcePath: "",
          fileName: file.originalname,
          mimeType: file.mimetype || "application/octet-stream",
          buffer: file.buffer
        }))
      });
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/batch/run", async (_request, response, next) => {
    try {
      response.json(await jobService.runBatchJobs());
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/scheduler/run-now", async (_request, response, next) => {
    try {
      response.json(await scheduler.runScheduledBatch());
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/system/register-task", async (_request, response, next) => {
    try {
      const config = await configStore.getConfig();
      response.json(await scheduler.registerWindowsTask(config));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/system/unregister-task", async (_request, response, next) => {
    try {
      const config = await configStore.getConfig();
      await scheduler.unregisterWindowsTask(config.scheduler.taskName || "AnyGen Workbench Daily");
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/system/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.get("*", (_request, response) => {
    response.sendFile(path.join(projectRoot, "public", "index.html"));
  });

  app.use((error, _request, response, _next) => {
    response.status(500).json({
      error: error.message || "服务端出错了。"
    });
  });

  singleton = { app, scheduler, configStore, jobService };
  return singleton;
}

export async function runScheduledOnce() {
  const { scheduler } = await createServerApp();
  return await scheduler.runScheduledBatch();
}

async function openFolderDialog(description, initialPath = "") {
  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = '${escapePowerShell(description)}'
    $dialog.ShowNewFolderButton = $true
    $initialPath = '${escapePowerShell(initialPath)}'
    if ($initialPath -and (Test-Path $initialPath)) {
      $dialog.SelectedPath = $initialPath
    }
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
      Write-Output $dialog.SelectedPath
    }
  `;

  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
    cwd: projectRoot,
    windowsHide: false
  });

  return stdout.trim();
}

async function openFileDialog(filter, initialPath = "") {
  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Filter = '${escapePowerShell(filter)}'
    $initialPath = '${escapePowerShell(initialPath)}'
    if ($initialPath) {
      if (Test-Path $initialPath -PathType Container) {
        $dialog.InitialDirectory = $initialPath
      } elseif (Test-Path $initialPath) {
        $dialog.InitialDirectory = Split-Path -Path $initialPath -Parent
        $dialog.FileName = Split-Path -Path $initialPath -Leaf
      }
    }
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
      Write-Output $dialog.FileName
    }
  `;

  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
    cwd: projectRoot,
    windowsHide: false
  });

  return stdout.trim();
}

async function openLocalPath(targetPath) {
  if (isExternalTarget(targetPath)) {
    await execFileAsync("cmd.exe", ["/c", "start", "", targetPath], {
      cwd: projectRoot,
      windowsHide: true
    });
    return;
  }

  const normalized = path.resolve(targetPath);
  await execFileAsync("explorer.exe", [normalized], {
    cwd: projectRoot,
    windowsHide: true
  });
}

function escapePowerShell(value) {
  return String(value || "").replace(/'/g, "''");
}

function isExternalTarget(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(String(value || "").trim());
}

async function resolveAppLocation(configStore, key) {
  const config = await configStore.getConfig();
  const locations = {
    projectRoot,
    dataDirectory: configStore.dataDir,
    historyDirectory: path.join(configStore.dataDir, "history"),
    logDirectory: path.join(configStore.dataDir, "runtime"),
    manualOutputDirectory: config.manual.outputDirectory || "",
    batchSourceDirectory: config.batch.sourceDirectory || ""
  };

  const targetPath = locations[key];
  if (!targetPath) {
    return "";
  }

  if (["dataDirectory", "historyDirectory", "logDirectory", "manualOutputDirectory"].includes(key)) {
    await fs.mkdir(targetPath, { recursive: true });
  }

  return targetPath;
}

async function buildDiagnostics(configStore) {
  const config = await configStore.getConfig();
  const packageMeta = await readPackageMeta();
  const batchSourceDirectory = config.batch.sourceDirectory || "";
  const manualOutputDirectory = config.manual.outputDirectory || "";
  const runtimeRoot = path.join(projectRoot, "runtime", "node");
  const fallbackRuntimeRoot = path.join(projectRoot, "data", "runtime", "node");
  const resolvedExecPath = path.resolve(process.execPath);
  const usingBundledRuntime = [
    path.resolve(runtimeRoot) + path.sep,
    path.resolve(fallbackRuntimeRoot) + path.sep
  ].some((prefix) => resolvedExecPath.startsWith(prefix));

  const checklist = [
    {
      key: "api-key",
      label: "AnyGen API Key",
      ok: Boolean(config.anygen.apiKey?.trim()),
      detail: config.anygen.apiKey?.trim() ? "已填写" : "还没有填写，保存配置后即可生效"
    },
    {
      key: "runtime",
      label: "运行环境",
      ok: true,
      detail: usingBundledRuntime ? "正在使用内置便携环境" : "正在使用这台电脑已经安装好的运行环境"
    },
    {
      key: "manual-output",
      label: "手动结果目录",
      ok: Boolean(manualOutputDirectory),
      detail: manualOutputDirectory || "建议设置一个总输出目录，便于朋友直接找结果"
    },
    {
      key: "batch-source",
      label: "批量源目录",
      ok: Boolean(batchSourceDirectory) && existsSync(batchSourceDirectory),
      detail: batchSourceDirectory
        ? batchSourceDirectory
        : "还没有设置批量源目录，只有手动模式也可以先用"
    }
  ];

  return {
    app: {
      name: "AnyGen 本地工作台",
      version: packageMeta.version || "0.0.0",
      homeUrl: `http://${host}:${port}/`
    },
    runtime: {
      nodeVersion: process.versions.node,
      execPath: process.execPath,
      mode: usingBundledRuntime ? "bundled" : "system"
    },
    paths: {
      projectRoot,
      dataDirectory: configStore.dataDir,
      historyDirectory: path.join(configStore.dataDir, "history"),
      logDirectory: path.join(configStore.dataDir, "runtime"),
      batchSourceDirectory,
      manualOutputDirectory
    },
    defaults: {
      downloadsDirectory: path.join(os.homedir(), "Downloads")
    },
    config: {
      apiKeyConfigured: Boolean(config.anygen.apiKey?.trim()),
      baseUrl: config.anygen.baseUrl || "https://www.anygen.io",
      operation: config.anygen.operation || "chat",
      schedulerEnabled: Boolean(config.scheduler.enabled),
      schedulerTime: config.scheduler.time || "09:00"
    },
    checklist,
    banner: buildBannerMessage(config, checklist)
  };
}

function buildBannerMessage(config, checklist) {
  if (!config.anygen.apiKey?.trim()) {
    return {
      tone: "warning",
      title: "先填 API Key",
      body: "保存后就能开始使用。"
    };
  }

  const missingDirectories = checklist.filter((item) => !item.ok && ["manual-output", "batch-source"].includes(item.key));
  if (missingDirectories.length > 0) {
    return {
      tone: "info",
      title: "已就绪",
      body: "可以直接开始使用。"
    };
  }

  return {
    tone: "success",
    title: "已就绪",
    body: "可以直接开始使用。"
  };
}

async function readPackageMeta() {
  try {
    const text = await fs.readFile(path.join(projectRoot, "package.json"), "utf8");
    return JSON.parse(text);
  } catch {
    return {};
  }
}
