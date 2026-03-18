import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { ensureDir, fileExists, readJson, writeJson } from "../utils/file-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");
const dataDir = path.join(rootDir, "data");
const configFile = path.join(dataDir, "settings.json");
const historyFile = path.join(dataDir, "history", "index.json");
const localApiKeyFile = path.join(rootDir, "API key.txt");
const defaultBatchSourceDir = path.join(rootDir, "作品");

export const defaultConfig = {
  anygen: {
    apiKey: "",
    baseUrl: "https://www.anygen.io",
    operation: "doc",
    language: "zh-CN",
    style: "clean editorial for 小红书 图文",
    slideCount: "",
    ratio: "16:9",
    docFormat: "docx",
    smartDrawFormat: "drawio",
    pollIntervalSeconds: 5,
    maxPollSeconds: 900,
    extraHeaders: ""
  },
  manual: {
    prompt: "",
    outputDirectory: "",
    referenceDirectory: ""
  },
  batch: {
    mode: "folders",
    sourceDirectory: "",
    spreadsheetPath: "",
    fallbackPrompt: "请基于我提供的参考文本和参考图片，生成适合小红书发布的图文内容。请输出清晰标题、正文结构和配图方案，语言自然、可直接发布。",
    includeRootWhenNoSubfolders: true,
    saveIntoSourceFolder: true,
    outputRootDirectory: "",
    maxJobsPerRun: 20
  },
  scheduler: {
    enabled: false,
    time: "09:00",
    registerWindowsTask: false,
    taskName: "AnyGen Workbench Daily"
  }
};

export class ConfigStore {
  constructor() {
    this.rootDir = rootDir;
    this.dataDir = dataDir;
    this.configFile = configFile;
    this.historyFile = historyFile;
  }

  async init() {
    await ensureDir(this.dataDir);
    await ensureDir(path.dirname(this.historyFile));
    const current = await this.getConfig();
    await this.saveConfig(current);
  }

  async getConfig() {
    const saved = await readJson(this.configFile, {});
    const merged = mergeDeep(defaultConfig, saved);
    const detectedApiKey = await detectLocalApiKey();
    if (!merged.anygen.apiKey && detectedApiKey) {
      merged.anygen.apiKey = detectedApiKey;
    }
    if (!merged.batch.sourceDirectory && await fileExists(defaultBatchSourceDir)) {
      merged.batch.sourceDirectory = defaultBatchSourceDir;
    }
    return merged;
  }

  async saveConfig(nextConfig) {
    const merged = mergeDeep(defaultConfig, nextConfig);
    await writeJson(this.configFile, merged);
    return merged;
  }

  async updateConfig(partialConfig) {
    const current = await this.getConfig();
    const merged = mergeDeep(current, partialConfig);
    await writeJson(this.configFile, merged);
    return merged;
  }

  async getHistory() {
    return await readJson(this.historyFile, []);
  }

  async appendHistory(entry) {
    const current = await this.getHistory();
    current.unshift(entry);
    await writeJson(this.historyFile, current.slice(0, 120));
  }
}

function mergeDeep(base, patch) {
  if (Array.isArray(base)) {
    return Array.isArray(patch) ? patch.slice() : base.slice();
  }

  if (!isObject(base)) {
    return patch === undefined ? base : patch;
  }

  const result = { ...base };
  for (const [key, value] of Object.entries(patch || {})) {
    if (isObject(value) && isObject(result[key])) {
      result[key] = mergeDeep(result[key], value);
      continue;
    }

    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

async function detectLocalApiKey() {
  const envKey = process.env.ANYGEN_API_KEY?.trim();
  if (envKey) {
    return envKey;
  }

  try {
    const text = await fs.readFile(localApiKeyFile, "utf8");
    const matched = text.match(/ANYGEN_API_KEY\s*=\s*(sk-[A-Za-z0-9-]+)/);
    return matched ? matched[1] : "";
  } catch {
    return "";
  }
}
