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
const defaultManualPrompt = `帮我做笔记啊

1. 封面制作：基于提供的5张图片，制作小红书封面，视觉高级、文字有转化力，标题需偏向点击率，吸引对摄影感兴趣的人群；可指定单张封面做终稿，并将卖点压缩为3条钩子。
2. 配图制作：除封面外，其余内容配图各做1张，另外5张配图需提供2套方案，共10张配图。
3. 文案撰写：
- 结构遵循：痛点/提问 → 优势背书 → 课程/班型 → 适合人群 → 地域/校区 → CTA
- 输出2篇小红书文案，单篇不超过1000字，风格自然不生硬，正文需有良好排版和表情符号。
4. 发布平台：小红书。
5. 图片规格：3:4 | 2K档 1792×2400 | 高级排版 | 偏点击率。
6. 可以是参考图里面的场景，但是如果有人脸出现，那脸和衣服绝对不能是原来的人物，要出现改变生成。

补充背景

目标人群：对摄影感兴趣、希望获得摄影帮助的人群，想找教程，想学习的人群。
核心目的：提升点击率与转化。`;

const defaultPromptTemplates = [
  {
    id: "xiaohongshu-photography-default",
    name: "摄影笔记默认提示词",
    content: defaultManualPrompt
  }
];

export const defaultConfig = {
  anygen: {
    apiKey: "",
    baseUrl: "https://www.anygen.io",
    operation: "chat",
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
    referenceDirectory: "",
    selectedPromptTemplateId: "xiaohongshu-photography-default",
    promptTemplates: defaultPromptTemplates
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
    if (!saved?.anygen?.operation) {
      merged.anygen.operation = "chat";
    }
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
    const items = await readJson(this.historyFile, []);
    return await filterAsync(items, async (entry) => {
      if (!entry?.outputDirectory) {
        return true;
      }
      return await fileExists(entry.outputDirectory);
    });
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

async function filterAsync(items, predicate) {
  const checks = await Promise.all(items.map((item) => predicate(item)));
  return items.filter((_item, index) => checks[index]);
}
