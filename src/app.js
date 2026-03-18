import express from "express";
import multer from "multer";
import path from "node:path";
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

  app.post("/api/system/pick-folder", async (_request, response, next) => {
    try {
      const selectedPath = await openFolderDialog("选择文件夹");
      response.json({ path: selectedPath || "" });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/system/pick-file", async (request, response, next) => {
    try {
      const selectedPath = await openFileDialog(request.body?.filter || "所有文件|*.*");
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

async function openFolderDialog(description) {
  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = '${escapePowerShell(description)}'
    $dialog.ShowNewFolderButton = $true
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

async function openFileDialog(filter) {
  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Filter = '${escapePowerShell(filter)}'
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
  const normalized = path.resolve(targetPath);
  await execFileAsync("cmd.exe", ["/c", "start", "", normalized], {
    cwd: projectRoot,
    windowsHide: true
  });
}

function escapePowerShell(value) {
  return String(value || "").replace(/'/g, "''");
}
