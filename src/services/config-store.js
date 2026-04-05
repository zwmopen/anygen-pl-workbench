import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { ensureDir, fileExists, readJson, writeJson } from "../utils/file-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");
const dataDir = path.resolve(process.env.ANYGEN_DATA_DIR || path.join(rootDir, "data"));
const configFile = path.join(dataDir, "settings.json");
const historyFile = path.join(dataDir, "history", "index.json");
const localApiKeyFile = path.join(rootDir, "API key.txt");
const defaultBatchSourceDir = path.join(rootDir, "作品");
const defaultDownloadsDir = path.join(os.homedir(), "Downloads");

const defaultPromptTemplates = [
  {
    id: "blank-start",
    name: "空白开始",
    content: ""
  },
  {
    id: "general-writing",
    name: "通用写作",
    content: "请根据以下要求完成内容创作：\n\n主题：\n目标：\n受众：\n语气：\n结构要求：\n必须包含：\n"
  },
  {
    id: "xhs-copywriting",
    name: "小红书图文文案",
    content: "请帮我生成一篇适合小红书发布的图文文案。\n\n主题：\n目标人群：\n核心卖点：\n语气：自然、真实、能引发收藏\n输出要求：\n1. 给我 3 个标题\n2. 正文按开头吸引 + 中段干货 + 结尾互动来写\n3. 附上 5 到 8 个相关话题\n"
  },
  {
    id: "xhs-replica",
    name: "小红书复刻出图",
    content: "我会给你链接、原文案或参考图片，请你按“小红书成品包”的思路帮我整理输出。\n\n请完成：\n1. 提炼原内容的主题、结构和亮点\n2. 给出适合 3:4 图文的封面方向和内页结构\n3. 输出可直接发布的文案\n4. 为每一页补充清晰的生图提示词\n要求：简体中文、可直接拿去做图、不要空话\n"
  },
  {
    id: "photo-settings-card",
    name: "摄影参数卡",
    content: "请把下面的拍摄参数和场景信息整理成适合小红书发布的“摄影参数卡”内容。\n\n请输出：\n1. 一个封面标题\n2. 每组参数对应的场景说明\n3. 每页参数卡的排版建议\n4. 一段可直接发布的正文\n要求：参数值不要乱改，语言更好懂，适合新手直接照抄\n"
  },
  {
    id: "product-comparison",
    name: "数码横测对比",
    content: "请把下面的产品对比信息整理成“一图对比/横测图”内容。\n\n产品列表：\n核心维度：\n目标人群：\n\n请输出：\n1. 封面标题\n2. 对比表结构\n3. 每个产品的卖点总结\n4. 一段可直接发布的导购文案\n要求：信息清晰，适合做 3:4 竖版图文，参数不编造\n"
  }
];
const templateCatalogVersion = 2;

export const defaultConfig = {
  anygen: {
    apiKey: "",
    baseUrl: "https://www.anygen.io",
    operation: "chat",
    language: "zh-CN",
    style: "",
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
    selectedPromptTemplateId: "blank-start",
    templateCatalogVersion,
    promptTemplates: defaultPromptTemplates
  },
  batch: {
    mode: "folders",
    sourceDirectory: "",
    spreadsheetPath: "",
    fallbackPrompt: "请基于我提供的参考文本和参考图片，生成适合发布的图文内容。请输出清晰标题、正文结构和配图方案，语言自然，可直接使用。",
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
  },
  account: {
    autoCheckIn: false,
    sessionReady: false,
    lastCheckInAt: "",
    lastCheckInDate: "",
    lastCheckInStatus: "",
    lastCheckInMessage: "",
    lastCreditsText: "",
    lastCreditsObservedAt: "",
    lastDetectedLinks: {},
    lastProfileLabel: ""
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
    merged.manual.promptTemplates = mergePromptTemplates(
      saved?.manual?.promptTemplates,
      saved?.manual?.templateCatalogVersion
    );
    merged.manual.templateCatalogVersion = templateCatalogVersion;

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

    if (!merged.manual.outputDirectory) {
      merged.manual.outputDirectory = defaultDownloadsDir;
    }

    if (!merged.batch.outputRootDirectory) {
      merged.batch.outputRootDirectory = defaultDownloadsDir;
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

function mergePromptTemplates(savedTemplates, savedVersion) {
  const existing = Array.isArray(savedTemplates)
    ? savedTemplates
      .map((template, index) => ({
        id: String(template?.id || `prompt-template-${index + 1}`),
        name: String(template?.name || "").trim(),
        content: String(template?.content || "")
      }))
      .filter((template) => template.name)
    : [];

  if (savedVersion === templateCatalogVersion) {
    return existing;
  }

  const byId = new Map(existing.map((template) => [template.id, template]));
  const merged = [...existing];

  defaultPromptTemplates.forEach((template) => {
    if (!byId.has(template.id)) {
      merged.push({ ...template });
    }
  });

  return merged;
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
