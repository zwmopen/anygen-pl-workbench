import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import mammoth from "mammoth";
import {
  ensureDir,
  fileExists,
  guessMimeType,
  isSupportedReferenceFile,
  isTextPromptFile,
  listImmediateDirectories,
  listImmediateFiles,
  readText,
  slugify,
  timestampId,
  writeJson,
  writeText
} from "../utils/file-utils.js";

const IMAGE_NAME_PATTERN = /\.(png|jpg|jpeg|webp|gif|bmp)(\?|$)/i;
const execFile = promisify(execFileCallback);

export class JobService {
  constructor({ configStore, anygenClient }) {
    this.configStore = configStore;
    this.anygenClient = anygenClient;
    this.historyDir = path.join(this.configStore.dataDir, "history");
  }

  async init() {
    await ensureDir(this.historyDir);
  }

  async runManualJob(payload) {
    const config = await this.configStore.getConfig();
    const referenceFiles = dedupeFiles([
      ...(await this.loadReferenceFilesFromDirectory(payload.referenceDirectory || config.manual.referenceDirectory)),
      ...(payload.uploadedFiles || [])
    ]);

    return await this.executeRun({
      mode: "manual",
      name: payload.name || "手动任务",
      prompt: payload.prompt,
      outputDirectory: payload.outputDirectory || config.manual.outputDirectory || this.historyDir,
      referenceFiles,
      options: {
        ...config.anygen,
        operation: payload.operation || config.anygen.operation
      }
    });
  }

  async runBatchJobs(overrideConfig = null, runSource = "manual-batch") {
    const config = overrideConfig || await this.configStore.getConfig();
    const jobs = config.batch.mode === "spreadsheet"
      ? await this.buildJobsFromSpreadsheet(config)
      : await this.buildJobsFromFolders(config);

    const limitedJobs = jobs.slice(0, Number(config.batch.maxJobsPerRun || 20));
    const results = [];
    for (const job of limitedJobs) {
      try {
        results.push(await this.executeRun({
          mode: runSource,
          name: job.name,
          prompt: job.prompt,
          outputDirectory: job.outputDirectory,
          referenceFiles: job.referenceFiles,
          options: {
            ...config.anygen,
            ...job.anygenOverrides
          }
        }));
      } catch (error) {
        results.push(error.runEntry || {
          name: job.name,
          mode: runSource,
          status: "failed",
          error: error.message
        });
      }
    }

    const completed = results.filter((item) => item.status === "completed").length;
    const partial = results.filter((item) => item.status === "partial").length;
    const failed = results.filter((item) => item.status === "failed").length;

    return {
      total: limitedJobs.length,
      completed,
      partial,
      failed,
      results
    };
  }

  async executeRun(runRequest) {
    if (!runRequest.prompt?.trim()) {
      throw new Error("提示词不能为空。");
    }

    const runId = `${timestampId()}-${slugify(runRequest.name)}`;
    const actualOutputDirectory = this.resolveRunOutputDirectory(runRequest, runId);
    const runMetaDir = path.join(this.historyDir, `${runId}-meta`);
    await ensureDir(runMetaDir);
    await ensureDir(actualOutputDirectory);

    let taskId = null;
    try {
      const extraHeaders = parseExtraHeaders(runRequest.options.extraHeaders);
      taskId = await this.anygenClient.createTask({
        ...runRequest.options,
        prompt: runRequest.prompt,
        referenceFiles: runRequest.referenceFiles,
        extraHeaders
      });

      const task = await this.anygenClient.pollTask(taskId, {
        ...runRequest.options,
        extraHeaders
      });

      const saved = await this.persistTaskArtifacts(task, runMetaDir, actualOutputDirectory, runRequest.name);
      const finalStatus = deriveRunStatus(task.status, saved);
      const entry = {
        id: runId,
        taskId,
        name: runRequest.name,
        mode: runRequest.mode,
        status: finalStatus,
        taskStatus: task.status,
        prompt: runRequest.prompt,
        createdAt: new Date().toISOString(),
        outputDirectory: actualOutputDirectory,
        taskUrl: saved.taskUrl,
        files: saved.savedFiles,
        warnings: saved.warnings,
        artifactSummary: saved.artifactSummary
      };
      await this.configStore.appendHistory(entry);

      return {
        ...entry,
        task
      };
    } catch (error) {
      const failedEntry = {
        id: runId,
        taskId,
        name: runRequest.name,
        mode: runRequest.mode,
        status: "failed",
        prompt: runRequest.prompt,
        createdAt: new Date().toISOString(),
        outputDirectory: actualOutputDirectory,
        taskUrl: "",
        files: [],
        warnings: [],
        artifactSummary: {
          savedFileCount: 0,
          downloadedAttachmentCount: 0,
          imageCount: 0,
          warningCount: 0,
          textSaved: false
        },
        error: error.message
      };

      await writeJson(path.join(runMetaDir, "task-error.json"), {
        error: error.message,
        taskId,
        occurredAt: failedEntry.createdAt
      });
      await this.configStore.appendHistory(failedEntry);
      error.runEntry = failedEntry;
      throw error;
    }
  }

  resolveRunOutputDirectory(runRequest, runId) {
    const baseOutputDirectory = path.resolve(runRequest.outputDirectory || this.historyDir);
    const historyRoot = path.resolve(this.historyDir);

    if (runRequest.mode === "manual" || baseOutputDirectory === historyRoot) {
      return path.join(baseOutputDirectory, runId);
    }

    return baseOutputDirectory;
  }

  async persistTaskArtifacts(task, runMetaDir, outputDirectory, runName) {
    await writeJson(path.join(runMetaDir, "task-response.json"), task);

    const output = task.output || {};
    const savedFiles = [];
    const taskUrl = output.task_url || "";
    const warnings = [];
    let downloadedAttachmentCount = 0;
    let imageCount = 0;
    let textSaved = false;

    const textContent = extractTextContent(task);
    if (textContent) {
      const markdownPath = path.join(outputDirectory, `${slugify(runName)}-result.md`);
      await writeText(markdownPath, textContent);
      savedFiles.push(markdownPath);
      textSaved = true;
    }

    if (output.file_url) {
      const filename = safeFileName(output.file_name || `${slugify(runName)}.bin`);
      const targetPath = path.join(outputDirectory, filename);
      await downloadToFile(output.file_url, targetPath);
      savedFiles.push(targetPath);
      downloadedAttachmentCount += 1;
      const expanded = await expandDownloadedArtifacts(targetPath);
      savedFiles.push(...expanded);
    }

    const imageUrls = Array.from(collectImageUrls(task)).filter((url) => url !== output.file_url);
    for (let index = 0; index < imageUrls.length; index += 1) {
      const imageUrl = imageUrls[index];
      const extension = extensionFromUrl(imageUrl) || ".png";
      const targetPath = path.join(outputDirectory, `${slugify(runName)}-image-${String(index + 1).padStart(2, "0")}${extension}`);
      await downloadToFile(imageUrl, targetPath);
      savedFiles.push(targetPath);
      imageCount += 1;
    }

    if (task.needs_export && output.task_url) {
      const exportResult = await exportTaskAssetsFromBrowser({
        taskUrl: output.task_url,
        outputDirectory,
        baseName: slugify(runName) || "task"
      });
      if (exportResult.warning) {
        warnings.push(exportResult.warning);
      }

      for (const exportedFile of exportResult.savedFiles) {
        if (!savedFiles.includes(exportedFile)) {
          savedFiles.push(exportedFile);
          downloadedAttachmentCount += 1;
        }

        const expandedFiles = await expandDownloadedArtifacts(exportedFile);
        for (const expandedFile of expandedFiles) {
          if (!savedFiles.includes(expandedFile)) {
            savedFiles.push(expandedFile);
          }
        }
      }
    } else if (task.needs_export && !output.task_url) {
      warnings.push("任务需要导出附件，但当前返回里没有可打开的任务页地址。");
    }

    if (savedFiles.length === 0) {
      warnings.push("任务已完成，但没有检测到可落地的文本、附件或图片。");
    }

    const summaryPath = path.join(runMetaDir, "task-summary.json");
    const artifactSummary = {
      savedFileCount: savedFiles.length,
      downloadedAttachmentCount,
      imageCount,
      warningCount: warnings.length,
      textSaved
    };

    await writeJson(summaryPath, {
      taskId: task.task_id || null,
      taskUrl,
      status: task.status,
      output,
      warnings,
      artifactSummary
    });

    return { savedFiles, taskUrl, warnings, artifactSummary };
  }

  async buildJobsFromFolders(config) {
    const sourceDir = config.batch.sourceDirectory;
    if (!sourceDir) {
      throw new Error("请先设置批量任务的源文件夹。");
    }
    if (!await fileExists(sourceDir)) {
      throw new Error(`批量源文件夹不存在：${sourceDir}`);
    }

    const childDirectories = await listImmediateDirectories(sourceDir);
    const directories = childDirectories.length
      ? childDirectories
      : (config.batch.includeRootWhenNoSubfolders ? [sourceDir] : []);

    const jobs = [];
    for (const directory of directories) {
      const files = await listImmediateFiles(directory);
      const promptFiles = files.filter(isTextPromptFile);
      const promptFromFile = await readPromptFiles(promptFiles);
      const referenceFiles = await loadReferenceFiles(files);
      const prompt = (promptFromFile || config.batch.fallbackPrompt || "").trim();

      if (!prompt && referenceFiles.length === 0) {
        continue;
      }

      jobs.push({
        name: path.basename(directory),
        prompt,
        referenceFiles,
        outputDirectory: resolveOutputDirectory(config.batch, directory),
        anygenOverrides: {}
      });
    }

    return jobs;
  }

  async buildJobsFromSpreadsheet(config) {
    const spreadsheetPath = config.batch.spreadsheetPath;
    if (!spreadsheetPath) {
      throw new Error("请先设置批量表格路径。");
    }
    if (!await fileExists(spreadsheetPath)) {
      throw new Error(`批量表格不存在：${spreadsheetPath}`);
    }

    const rows = spreadsheetPath.toLowerCase().endsWith(".csv")
      ? await readCsvRows(spreadsheetPath)
      : await readExcelRows(spreadsheetPath);

    const jobs = await Promise.all(rows.map(async (row, index) => {
      const mapped = mapSpreadsheetRow(row);
      const referenceFiles = await this.loadReferenceFilesFromDirectory(mapped.referenceDirectory);
      const prompt = (mapped.prompt || config.batch.fallbackPrompt || "").trim();
      if (!prompt && referenceFiles.length === 0) {
        return null;
      }

      return {
        name: mapped.name || `row-${index + 1}`,
        prompt,
        referenceFiles,
        outputDirectory: mapped.outputDirectory || resolveOutputDirectory(config.batch, mapped.referenceDirectory || config.batch.sourceDirectory || this.historyDir),
        anygenOverrides: {
          operation: mapped.operation || undefined,
          language: mapped.language || undefined,
          style: mapped.style || undefined
        }
      };
    }));

    return jobs.filter(Boolean);
  }

  async loadReferenceFilesFromDirectory(referenceDirectory) {
    if (!referenceDirectory || !await fileExists(referenceDirectory)) {
      return [];
    }
    const files = await listImmediateFiles(referenceDirectory);
    return await loadReferenceFiles(files);
  }
}

async function exportTaskAssetsFromBrowser({ taskUrl, outputDirectory, baseName }) {
  const scriptPath = await resolveBundledScriptPath("export-anygen-task-assets.ps1");
  if (!await fileExists(scriptPath)) {
    return {
      savedFiles: [],
      warning: "本机没有导出脚本，已跳过自动导出附件。"
    };
  }

  try {
    const { stdout } = await execFile("powershell", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-TaskUrl",
      taskUrl,
      "-OutputDirectory",
      outputDirectory,
      "-BaseName",
      baseName
    ], {
      timeout: 180000,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8
    });

    const parsed = parseLastJsonObject(stdout);
    if (!parsed) {
      return {
        savedFiles: [],
        warning: "自动导出没有返回可识别结果，建议手动打开任务页检查。"
      };
    }

    return {
      savedFiles: Array.isArray(parsed.savedFiles) ? parsed.savedFiles : [],
      warning: parsed.error ? `自动导出未完成：${parsed.error}` : ""
    };
  } catch (error) {
    return {
      savedFiles: [],
      warning: `自动导出失败：${error.message}`
    };
  }
}

async function resolveBundledScriptPath(fileName) {
  const candidates = [
    path.join(process.cwd(), "scripts", fileName),
    path.join(process.resourcesPath || "", "app.asar.unpacked", "scripts", fileName),
    path.join(process.resourcesPath || "", "scripts", fileName)
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return candidates[0] || path.join(process.cwd(), "scripts", fileName);
}

async function readExcelRows(spreadsheetPath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(spreadsheetPath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return [];
  }

  const headers = [];
  worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    headers[columnNumber - 1] = String(cell.value || "").trim();
  });

  const rows = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }
    const entry = {};
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      const header = headers[columnNumber - 1];
      if (!header) {
        return;
      }
      entry[header] = stringifyCellValue(cell.value);
    });
    rows.push(entry);
  });
  return rows;
}

async function readCsvRows(spreadsheetPath) {
  const raw = await fs.readFile(spreadsheetPath, "utf8");
  const records = parseCsvRecords(raw);
  if (records.length === 0) {
    return [];
  }

  const headers = records[0].map((cell) => String(cell || "").trim());
  return records.slice(1).filter((record) => record.some((cell) => String(cell || "").trim())).map((columns) => {
    return headers.reduce((entry, header, index) => {
      entry[header] = columns[index] || "";
      return entry;
    }, {});
  });
}

function parseCsvRecords(raw) {
  const rows = [];
  let currentRow = [];
  let currentCell = "";
  let inQuotes = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === '"') {
      if (inQuotes && raw[index + 1] === '"') {
        currentCell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(normalizeCsvCell(currentCell));
      currentCell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && raw[index + 1] === "\n") {
        index += 1;
      }
      currentRow.push(normalizeCsvCell(currentCell));
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
      continue;
    }

    currentCell += char;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(normalizeCsvCell(currentCell));
    rows.push(currentRow);
  }

  return rows.filter((row) => row.length > 0);
}

function normalizeCsvCell(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function stringifyCellValue(value) {
  if (value == null) {
    return "";
  }
  if (typeof value === "object") {
    if ("text" in value && value.text != null) {
      return String(value.text);
    }
    if ("result" in value && value.result != null) {
      return String(value.result);
    }
  }
  return String(value);
}

async function loadReferenceFiles(filePaths) {
  const files = [];
  for (const filePath of filePaths.filter(isSupportedReferenceFile)) {
    const buffer = await fs.readFile(filePath);
    files.push({
      sourcePath: filePath,
      fileName: path.basename(filePath),
      mimeType: guessMimeType(filePath),
      buffer
    });
  }
  return files;
}

function dedupeFiles(files) {
  const seen = new Set();
  return files.filter((file) => {
    const key = file.sourcePath || `${file.fileName}-${file.buffer?.length || 0}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function readPromptFiles(promptFiles) {
  if (promptFiles.length === 0) {
    return "";
  }
  const ordered = [...promptFiles].sort((left, right) => promptPriority(path.basename(left)) - promptPriority(path.basename(right)));
  const contents = await Promise.all(ordered.map((filePath) => readText(filePath, "")));
  return contents.filter(Boolean).join("\n\n").trim();
}

function promptPriority(fileName) {
  const lower = fileName.toLowerCase();
  return lower === "prompt.md" || lower === "prompt.txt" ? 0 : 1;
}

function resolveOutputDirectory(batchConfig, sourceDirectory) {
  if (batchConfig.saveIntoSourceFolder && sourceDirectory) {
    return sourceDirectory;
  }
  if (batchConfig.outputRootDirectory) {
    return path.join(batchConfig.outputRootDirectory, path.basename(sourceDirectory || "result"));
  }
  return sourceDirectory || process.cwd();
}

function parseExtraHeaders(value) {
  const headers = {};
  const lines = String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const [key, ...rest] = line.split(":");
    if (!key || rest.length === 0) {
      continue;
    }
    headers[key.trim()] = rest.join(":").trim();
  }
  return headers;
}

function extractTextContent(task) {
  const output = task.output || {};
  const candidates = [
    output.markdown,
    output.content,
    output.text,
    output.article,
    output.doc_markdown,
    task.markdown,
    task.content,
    task.text
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  if (Array.isArray(output.sections) && output.sections.length > 0) {
    return output.sections.map((section) => `## ${section.title || "Section"}\n\n${section.content || ""}`).join("\n\n").trim();
  }

  return "";
}

function collectImageUrls(task) {
  const results = new Set();
  walkValues(task, (value) => {
    if (typeof value === "string" && /^https?:\/\//i.test(value) && IMAGE_NAME_PATTERN.test(value)) {
      results.add(value);
    }
  });
  return results;
}

function walkValues(value, visit) {
  if (Array.isArray(value)) {
    for (const item of value) {
      walkValues(item, visit);
    }
    return;
  }

  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) {
      walkValues(nested, visit);
    }
    return;
  }

  visit(value);
}

function extensionFromUrl(url) {
  try {
    const parsed = new URL(url);
    const found = parsed.pathname.match(/\.(png|jpg|jpeg|webp|gif|bmp)$/i);
    return found ? `.${found[1].toLowerCase()}` : "";
  } catch {
    return "";
  }
}

async function downloadToFile(url, targetPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载文件失败：${response.status} ${url}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  await fs.writeFile(targetPath, Buffer.from(arrayBuffer));
}

async function expandDownloadedArtifacts(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".zip") {
    return await expandZipArchive(filePath);
  }

  if (![".docx", ".pptx"].includes(extension)) {
    return [];
  }

  const buffer = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);
  const baseName = path.basename(filePath, extension);
  const targetDir = path.dirname(filePath);
  const savedFiles = [];

  const mediaEntries = Object.values(zip.files).filter((entry) =>
    !entry.dir && /\.(png|jpg|jpeg|webp|gif|bmp)$/i.test(entry.name)
  );

  for (const entry of mediaEntries) {
    const mediaBuffer = await entry.async("nodebuffer");
    const outputName = `${baseName}-${path.basename(entry.name)}`;
    const outputPath = path.join(targetDir, outputName);
    await fs.writeFile(outputPath, mediaBuffer);
    savedFiles.push(outputPath);
  }

  if (extension === ".docx") {
    const extracted = await mammoth.extractRawText({ buffer });
    const text = extracted.value?.trim();
    if (text) {
      const markdownPath = path.join(targetDir, `${baseName}-正文.md`);
      await fs.writeFile(markdownPath, `${text}\n`, "utf8");
      savedFiles.push(markdownPath);
    }
  }

  return savedFiles;
}

async function expandZipArchive(filePath) {
  const buffer = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);
  const extractDir = await createUniqueDirectory(
    path.dirname(filePath),
    safeFileName(path.basename(filePath, ".zip")) || "archive"
  );
  const savedFiles = [];

  for (const entry of Object.values(zip.files)) {
    if (entry.dir) {
      continue;
    }

    const outputPath = path.join(extractDir, ...normalizeZipSegments(entry.name));
    await ensureDir(path.dirname(outputPath));
    await fs.writeFile(outputPath, await entry.async("nodebuffer"));
    savedFiles.push(outputPath);
  }

  return savedFiles;
}

function normalizeZipSegments(entryName) {
  const segments = String(entryName || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .map((segment) => safeFileName(segment));

  return segments.length ? segments : ["unnamed-file"];
}

async function createUniqueDirectory(parentDir, baseName) {
  let candidate = path.join(parentDir, baseName);
  let counter = 1;

  while (await fileExists(candidate)) {
    candidate = path.join(parentDir, `${baseName}-${counter}`);
    counter += 1;
  }

  await ensureDir(candidate);
  return candidate;
}

function safeFileName(value) {
  return value.replace(/[<>:"/\\|?*]+/g, "-");
}

function parseLastJsonObject(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }

  const lines = text.split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const candidate = lines.slice(index).join("\n").trim();
    try {
      return JSON.parse(candidate);
    } catch {
      // Keep searching for the trailing JSON payload.
    }
  }

  return null;
}

function mapSpreadsheetRow(row) {
  const entries = Object.entries(row).reduce((accumulator, [key, value]) => {
    accumulator[String(key).trim().toLowerCase()] = String(value || "").trim();
    return accumulator;
  }, {});

  return {
    name: firstValue(entries, ["name", "名称", "title", "标题"]),
    prompt: firstValue(entries, ["prompt", "提示词", "文案", "需求"]),
    referenceDirectory: firstValue(entries, ["reference_dir", "reference directory", "参考目录", "素材目录"]),
    outputDirectory: firstValue(entries, ["output_dir", "output directory", "输出目录"]),
    operation: firstValue(entries, ["operation", "操作类型"]),
    language: firstValue(entries, ["language", "语言"]),
    style: firstValue(entries, ["style", "风格"])
  };
}

function firstValue(entries, keys) {
  for (const key of keys.map((item) => item.toLowerCase())) {
    if (entries[key]) {
      return entries[key];
    }
  }
  return "";
}

function deriveRunStatus(taskStatus, saved) {
  if (taskStatus === "failed") {
    return "failed";
  }

  if (saved.warnings.length > 0) {
    return "partial";
  }

  return "completed";
}
