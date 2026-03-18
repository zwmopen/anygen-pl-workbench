const elements = {
  apiKey: document.querySelector("#api-key"),
  baseUrl: document.querySelector("#base-url"),
  operation: document.querySelector("#operation"),
  language: document.querySelector("#language"),
  style: document.querySelector("#style"),
  extraHeaders: document.querySelector("#extra-headers"),
  manualPrompt: document.querySelector("#manual-prompt"),
  manualOutput: document.querySelector("#manual-output"),
  manualReferenceDir: document.querySelector("#manual-reference-dir"),
  manualFiles: document.querySelector("#manual-files"),
  batchMode: document.querySelector("#batch-mode"),
  batchSource: document.querySelector("#batch-source"),
  batchSheet: document.querySelector("#batch-sheet"),
  fallbackPrompt: document.querySelector("#fallback-prompt"),
  batchMax: document.querySelector("#batch-max"),
  saveIntoSource: document.querySelector("#save-into-source"),
  schedulerEnabled: document.querySelector("#scheduler-enabled"),
  schedulerTime: document.querySelector("#scheduler-time"),
  schedulerTaskName: document.querySelector("#scheduler-task-name"),
  historyList: document.querySelector("#history-list"),
  statusLog: document.querySelector("#status-log")
};

boot();

async function boot() {
  bindEvents();
  await hydrateConfig();
  await refreshHistory();
}

function bindEvents() {
  document.querySelector("#save-config").addEventListener("click", saveConfig);
  document.querySelector("#run-manual").addEventListener("click", runManual);
  document.querySelector("#run-batch").addEventListener("click", runBatch);
  document.querySelector("#run-schedule-now").addEventListener("click", runScheduleNow);
  document.querySelector("#register-task").addEventListener("click", registerSystemTask);
  document.querySelector("#refresh-history").addEventListener("click", refreshHistory);

  document.querySelectorAll("[data-pick]").forEach((button) => {
    button.addEventListener("click", async () => {
      const targetId = button.dataset.pick;
      const kind = button.dataset.kind;
      const filter = button.dataset.filter;
      const result = kind === "file"
        ? await requestJson("/api/system/pick-file", {
            method: "POST",
            body: JSON.stringify({ filter })
          })
        : await requestJson("/api/system/pick-folder", {
            method: "POST"
          });

      if (result?.path) {
        document.querySelector(`#${targetId}`).value = result.path;
      }
    });
  });
}

async function hydrateConfig() {
  const config = await requestJson("/api/config");
  elements.apiKey.value = config.anygen.apiKey || "";
  elements.baseUrl.value = config.anygen.baseUrl || "";
  elements.operation.value = config.anygen.operation || "chat";
  elements.language.value = config.anygen.language || "zh-CN";
  elements.style.value = config.anygen.style || "";
  elements.extraHeaders.value = config.anygen.extraHeaders || "";
  elements.manualPrompt.value = config.manual.prompt || "";
  elements.manualOutput.value = config.manual.outputDirectory || "";
  elements.manualReferenceDir.value = config.manual.referenceDirectory || "";
  elements.batchMode.value = config.batch.mode || "folders";
  elements.batchSource.value = config.batch.sourceDirectory || "";
  elements.batchSheet.value = config.batch.spreadsheetPath || "";
  elements.fallbackPrompt.value = config.batch.fallbackPrompt || "";
  elements.batchMax.value = config.batch.maxJobsPerRun || 20;
  elements.saveIntoSource.checked = Boolean(config.batch.saveIntoSourceFolder);
  elements.schedulerEnabled.checked = Boolean(config.scheduler.enabled);
  elements.schedulerTime.value = config.scheduler.time || "09:00";
  elements.schedulerTaskName.value = config.scheduler.taskName || "AnyGen Workbench Daily";
}

async function saveConfig() {
  await requestJson("/api/config", {
    method: "POST",
    body: JSON.stringify(collectConfigPayload())
  });
  log("配置已保存。");
}

async function runManual() {
  const prompt = elements.manualPrompt.value.trim();
  if (!prompt) {
    throwAndLog("请先输入提示词。");
    return;
  }

  await saveConfig();

  const formData = new FormData();
  formData.append("name", buildManualJobName(prompt));
  formData.append("prompt", prompt);
  formData.append("operation", elements.operation.value);
  formData.append("outputDirectory", elements.manualOutput.value.trim());
  formData.append("referenceDirectory", elements.manualReferenceDir.value.trim());

  Array.from(elements.manualFiles.files || []).forEach((file) => {
    formData.append("referenceFiles", file);
  });

  log("手动任务已发出，正在等待 AnyGen 返回并落地到本地目录。");

  try {
    const result = await requestJson("/api/manual/run", {
      method: "POST",
      body: formData
    }, false);

    log(formatSummary("手动任务完成", result));
    await refreshHistory();
  } catch (error) {
    throwAndLog(error.message);
  }
}

async function runBatch() {
  await saveConfig();
  log("批量任务开始执行，正在逐个目录或表格行处理。");

  try {
    const result = await requestJson("/api/batch/run", {
      method: "POST"
    });
    log(formatSummary("批量任务完成", result));
    await refreshHistory();
  } catch (error) {
    throwAndLog(error.message);
  }
}

async function runScheduleNow() {
  await saveConfig();
  log("正在立即执行一次定时任务。");

  try {
    const result = await requestJson("/api/scheduler/run-now", {
      method: "POST"
    });
    log(formatSummary("定时任务执行完成", result));
    await refreshHistory();
  } catch (error) {
    throwAndLog(error.message);
  }
}

async function registerSystemTask() {
  await saveConfig();

  try {
    const result = await requestJson("/api/system/register-task", {
      method: "POST"
    });
    log(`Windows 计划任务已注册：${result.taskName}，每天 ${result.time} 运行。`);
  } catch (error) {
    throwAndLog(error.message);
  }
}

async function refreshHistory() {
  const items = await requestJson("/api/history");
  elements.historyList.innerHTML = "";

  if (!items.length) {
    elements.historyList.innerHTML = `
      <div class="empty-state">
        <strong>还没有任务记录</strong>
        <p>先跑一次手动任务或批量任务，这里会显示每次任务的具体结果目录、文件数量和快捷入口。</p>
      </div>
    `;
    return;
  }

  for (const item of items.slice(0, 20)) {
    elements.historyList.appendChild(renderHistoryItem(item));
  }
}

function renderHistoryItem(item) {
  const article = document.createElement("article");
  article.className = "history-item";

  const fileCount = Array.isArray(item.files) ? item.files.length : 0;
  const createdAt = item.createdAt
    ? new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false })
    : "-";
  const modeLabel = formatMode(item.mode);
  const statusLabel = formatStatus(item.status);

  article.innerHTML = `
    <div class="history-top">
      <div class="history-title">
        <strong>${escapeHtml(item.name || "未命名任务")}</strong>
        <span class="status-chip ${escapeHtml(item.status || "unknown")}">${escapeHtml(statusLabel)}</span>
      </div>
      <div class="history-actions">
        <button class="button ghost compact" type="button" data-action="open-dir">打开结果目录</button>
        ${item.taskUrl ? '<button class="button ghost compact" type="button" data-action="open-task">打开任务页</button>' : ""}
      </div>
    </div>
    <div class="history-meta">
      <div class="meta-box">
        <span class="meta-label">模式</span>
        <span class="meta-value">${escapeHtml(modeLabel)}</span>
      </div>
      <div class="meta-box">
        <span class="meta-label">时间</span>
        <span class="meta-value">${escapeHtml(createdAt)}</span>
      </div>
      <div class="meta-box">
        <span class="meta-label">落地文件数</span>
        <span class="meta-value">${fileCount}</span>
      </div>
      <div class="meta-box">
        <span class="meta-label">任务 ID</span>
        <span class="meta-value">${escapeHtml(item.taskId || "-")}</span>
      </div>
    </div>
    <div class="result-path-row">
      <div class="result-path-text">
        <span class="meta-label">本次结果目录</span>
        <code class="path-pill">${escapeHtml(item.outputDirectory || "-")}</code>
      </div>
      <button class="button ghost compact" type="button" data-action="open-dir-inline">直达本次目录</button>
    </div>
    ${renderFileList(item.files)}
  `;

  const openDirectory = async () => {
    if (!item.outputDirectory) {
      return;
    }

    await requestJson("/api/system/open-path", {
      method: "POST",
      body: JSON.stringify({ path: item.outputDirectory })
    });
  };

  article.querySelector('[data-action="open-dir"]')?.addEventListener("click", openDirectory);
  article.querySelector('[data-action="open-dir-inline"]')?.addEventListener("click", openDirectory);
  article.querySelector('[data-action="open-task"]')?.addEventListener("click", () => {
    if (item.taskUrl) {
      window.open(item.taskUrl, "_blank", "noopener,noreferrer");
    }
  });

  return article;
}

function renderFileList(files = []) {
  if (!Array.isArray(files) || files.length === 0) {
    return "";
  }

  const visibleFiles = files
    .slice(0, 10)
    .map((filePath) => `<div class="history-file">${escapeHtml(filePath)}</div>`)
    .join("");
  const more = files.length > 10
    ? `<div class="history-file">还有 ${files.length - 10} 个文件未展开显示</div>`
    : "";

  return `
    <details class="history-files">
      <summary>查看本次落地文件</summary>
      <div class="history-file-list">
        ${visibleFiles}
        ${more}
      </div>
    </details>
  `;
}

function collectConfigPayload() {
  return {
    anygen: {
      apiKey: elements.apiKey.value.trim(),
      baseUrl: elements.baseUrl.value.trim(),
      operation: elements.operation.value,
      language: elements.language.value,
      style: elements.style.value.trim(),
      extraHeaders: elements.extraHeaders.value
    },
    manual: {
      prompt: elements.manualPrompt.value,
      outputDirectory: elements.manualOutput.value.trim(),
      referenceDirectory: elements.manualReferenceDir.value.trim()
    },
    batch: {
      mode: elements.batchMode.value,
      sourceDirectory: elements.batchSource.value.trim(),
      spreadsheetPath: elements.batchSheet.value.trim(),
      fallbackPrompt: elements.fallbackPrompt.value.trim(),
      maxJobsPerRun: Number(elements.batchMax.value || 20),
      saveIntoSourceFolder: elements.saveIntoSource.checked
    },
    scheduler: {
      enabled: elements.schedulerEnabled.checked,
      time: elements.schedulerTime.value,
      taskName: elements.schedulerTaskName.value.trim()
    }
  };
}

async function requestJson(url, options = {}, useJsonHeaders = true) {
  const headers = new Headers(options.headers || {});
  if (useJsonHeaders && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...options,
    headers
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error || "请求失败。");
  }
  return json;
}

function log(message) {
  const timestamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  elements.statusLog.textContent = `[${timestamp}] ${message}\n\n${elements.statusLog.textContent}`.trim();
}

function formatSummary(title, payload) {
  const lines = [title];

  if (payload?.taskId) {
    lines.push(`任务 ID：${payload.taskId}`);
  }

  if (payload?.outputDirectory) {
    lines.push(`结果目录：${payload.outputDirectory}`);
  }

  if (Array.isArray(payload?.files) && payload.files.length) {
    lines.push(`落地文件：${payload.files.length} 个`);
  }

  if (typeof payload?.total === "number") {
    lines.push(`本次处理：${payload.total} 个任务`);
  }

  return lines.join("\n");
}

function formatMode(mode) {
  const labels = {
    manual: "手动任务",
    "manual-batch": "手动批量",
    "scheduled-batch": "定时批量"
  };

  return labels[mode] || mode || "-";
}

function formatStatus(status) {
  const labels = {
    completed: "已完成",
    failed: "失败",
    processing: "处理中"
  };

  return labels[status] || status || "未知";
}

function buildManualJobName(prompt) {
  const firstLine = prompt.split(/\r?\n/).find(Boolean) || "手动任务";
  return firstLine.slice(0, 24).trim() || "手动任务";
}

function throwAndLog(message) {
  log(`出错：${message}`);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
