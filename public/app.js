const elements = {
  navLinks: Array.from(document.querySelectorAll("[data-tab]")),
  viewPanels: Array.from(document.querySelectorAll("[data-panel]")),
  apiKey: document.querySelector("#api-key"),
  baseUrl: document.querySelector("#base-url"),
  operation: document.querySelector("#operation"),
  language: document.querySelector("#language"),
  style: document.querySelector("#style"),
  manualTemplateSelect: document.querySelector("#manual-template-select"),
  manualTemplateMeta: document.querySelector("#manual-template-meta"),
  openTemplateModal: document.querySelector("#open-template-modal"),
  templateModal: document.querySelector("#template-modal"),
  templateForm: document.querySelector("#template-form"),
  templateNameInput: document.querySelector("#template-name-input"),
  templateContentInput: document.querySelector("#template-content-input"),
  cancelTemplateModal: document.querySelector("#cancel-template-modal"),
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
  setupChecklist: document.querySelector("#setup-checklist"),
  homeUrl: document.querySelector("#home-url"),
  runtimeMode: document.querySelector("#runtime-mode"),
  schedulerSummary: document.querySelector("#scheduler-summary"),
  openOutputDir: document.querySelector("#open-output-dir"),
  openLogDir: document.querySelector("#open-log-dir"),
  openHistoryDir: document.querySelector("#open-history-dir"),
  historySearch: document.querySelector("#history-search"),
  historyStatusFilter: document.querySelector("#history-status-filter"),
  clearStatusLog: document.querySelector("#clear-status-log"),
  runState: document.querySelector("#run-state"),
  historyOverview: document.querySelector("#history-overview"),
  historyList: document.querySelector("#history-list"),
  statusLog: document.querySelector("#status-log")
};

let latestDiagnostics = null;
let promptTemplates = [];
let activeRuns = 0;
let historyItemsCache = [];

boot();

async function boot() {
  bindEvents();
  await hydrateConfig();
  await refreshDiagnostics();
  await refreshHistory();
}

function bindEvents() {
  elements.navLinks.forEach((button) => {
    button.addEventListener("click", () => setActiveTab(button.dataset.tab || "compose"));
  });
  document.querySelector("#save-config").addEventListener("click", saveConfig);
  document.querySelector("#run-manual").addEventListener("click", runManual);
  document.querySelector("#run-batch").addEventListener("click", runBatch);
  document.querySelector("#run-schedule-now").addEventListener("click", runScheduleNow);
  document.querySelector("#register-task").addEventListener("click", registerSystemTask);
  document.querySelector("#refresh-history").addEventListener("click", refreshHistory);
  elements.manualTemplateSelect.addEventListener("change", applySelectedPromptTemplate);
  elements.openTemplateModal.addEventListener("click", openPromptTemplateModal);
  elements.cancelTemplateModal.addEventListener("click", closePromptTemplateModal);
  elements.templateForm.addEventListener("submit", submitPromptTemplate);
  elements.openOutputDir.addEventListener("click", () => openAppLocation("manualOutputDirectory", "保存位置"));
  elements.openLogDir.addEventListener("click", () => openAppLocation("logDirectory", "日志目录"));
  elements.openHistoryDir.addEventListener("click", () => openAppLocation("historyDirectory", "历史目录"));
  elements.clearStatusLog.addEventListener("click", clearStatusLog);
  elements.historySearch.addEventListener("input", renderHistoryList);
  elements.historyStatusFilter.addEventListener("change", renderHistoryList);

  document.querySelectorAll("[data-pick]").forEach((button) => {
    button.addEventListener("click", async () => {
      const targetId = button.dataset.pick;
      const kind = button.dataset.kind;
      const filter = button.dataset.filter;
      const initialPath = document.querySelector(`#${targetId}`)?.value?.trim() || "";
      const result = kind === "file"
        ? await requestJson("/api/system/pick-file", {
            method: "POST",
            body: JSON.stringify({ filter, initialPath })
          })
        : await requestJson("/api/system/pick-folder", {
            method: "POST",
            body: JSON.stringify({ initialPath })
          });

      if (result?.path) {
        document.querySelector(`#${targetId}`).value = result.path;
        await saveConfig({ silent: true });
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
  promptTemplates = normalizePromptTemplates(config.manual.promptTemplates);
  renderPromptTemplateOptions(config.manual.selectedPromptTemplateId);
  const manualPrompt = String(config.manual.prompt || "").trim();
  elements.manualPrompt.value = manualPrompt || (getSelectedPromptTemplate()?.content || "");
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
  renderManualTemplateState();
  setActiveTab(readSavedTab());
}

async function saveConfig(options = {}) {
  const { silent = false } = options;
  await withButtonBusy(document.querySelector("#save-config"), "保存中...", async () => {
    await requestJson("/api/config", {
      method: "POST",
      body: JSON.stringify(collectConfigPayload())
    });
  });
  await refreshDiagnostics();
  if (!silent) {
    log("配置已保存。");
  }
}

async function runManual() {
  const prompt = elements.manualPrompt.value.trim();
  if (!prompt) {
    throwAndLog("请填充提示词。");
    return;
  }

  await withRunState("手动任务运行中，正在等待 AnyGen 返回结果。", async () => {
    await withButtonBusy(document.querySelector("#run-manual"), "运行中...", async () => {
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
    });
  });
}

async function runBatch() {
  await withRunState("批量任务运行中，正在逐个目录或表格行处理。", async () => {
    await withButtonBusy(document.querySelector("#run-batch"), "批量运行中...", async () => {
      await saveConfig();
      log("批量任务开始执行，正在逐个目录或表格行处理。");

      try {
        const result = await requestJson("/api/batch/run", {
          method: "POST"
        });
        log(formatSummary("批量任务完成", result));
        await refreshHistory();
        setActiveTab("history");
      } catch (error) {
        throwAndLog(error.message);
      }
    });
  });
}

async function runScheduleNow() {
  await withRunState("定时任务正在立即执行这一轮。", async () => {
    await withButtonBusy(document.querySelector("#run-schedule-now"), "执行中...", async () => {
      await saveConfig();
      log("正在立即执行一次定时任务。");

      try {
        const result = await requestJson("/api/scheduler/run-now", {
          method: "POST"
        });
        log(formatSummary("定时任务执行完成", result));
        await refreshHistory();
        setActiveTab("history");
      } catch (error) {
        throwAndLog(error.message);
      }
    });
  });
}

async function registerSystemTask() {
  await withButtonBusy(document.querySelector("#register-task"), "注册中...", async () => {
    await saveConfig();

    try {
      const result = await requestJson("/api/system/register-task", {
        method: "POST"
      });
      log(`Windows 计划任务已注册：${result.taskName}，每天 ${result.time} 运行。${result.timezone ? ` 当前时区：${result.timezone}。` : ""}`);
    } catch (error) {
      throwAndLog(error.message);
    }
  });
}

async function refreshHistory() {
  historyItemsCache = await requestJson("/api/history");
  renderHistoryOverview(historyItemsCache);
  renderHistoryList();
}

function renderHistoryList() {
  const items = filterHistoryItems(historyItemsCache);
  elements.historyList.innerHTML = "";

  if (!items.length) {
    const hasFilters = Boolean(elements.historySearch.value.trim()) || elements.historyStatusFilter.value !== "all";
    elements.historyList.innerHTML = `
      <div class="empty-state">
        <strong>${hasFilters ? "没有匹配的记录" : "还没有任务记录"}</strong>
        <p>${hasFilters ? "换一个关键词或状态试试。" : "先跑一次手动任务或批量任务，这里会显示每次任务的具体结果目录、文件数量和快捷入口。"}</p>
      </div>
    `;
    return;
  }

  for (const item of items.slice(0, 30)) {
    elements.historyList.appendChild(renderHistoryItem(item));
  }
}

async function refreshDiagnostics() {
  latestDiagnostics = await requestJson("/api/system/diagnostics");
  renderDiagnostics(latestDiagnostics);
}

function renderDiagnostics(diagnostics) {
  const checklistItems = Array.isArray(diagnostics?.checklist) ? diagnostics.checklist : [];
  elements.setupChecklist.innerHTML = checklistItems.map((item) => `
    <article class="check-item ${item.ok ? "is-ok" : "is-pending"}">
      <div class="check-dot">${item.ok ? "已就绪" : "待处理"}</div>
      <div class="check-copy">
        <strong>${escapeHtml(item.label || "-")}</strong>
        <p>${escapeHtml(item.detail || "")}</p>
      </div>
    </article>
  `).join("");

  elements.homeUrl.textContent = diagnostics?.paths?.manualOutputDirectory || "-";
  elements.runtimeMode.textContent = diagnostics?.runtime?.mode === "bundled"
    ? `内置便携版，可直接打开就用`
    : `使用本机已安装环境`;
  elements.schedulerSummary.textContent = diagnostics?.config?.schedulerEnabled
    ? `已开启，每天 ${diagnostics.config.schedulerTime || "09:00"}`
    : "未开启";
}

function renderHistoryOverview(items) {
  if (!Array.isArray(items) || items.length === 0) {
    elements.historyOverview.innerHTML = "";
    return;
  }

  const completed = items.filter((item) => item.status === "completed").length;
  const partial = items.filter((item) => item.status === "partial").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const latestCreatedAt = items[0]?.createdAt
    ? new Date(items[0].createdAt).toLocaleString("zh-CN", { hour12: false })
    : "-";

  elements.historyOverview.innerHTML = `
    <div class="overview-card">
      <span class="overview-label">最近记录</span>
      <strong class="overview-value">${items.length}</strong>
    </div>
    <div class="overview-card">
      <span class="overview-label">已完成</span>
      <strong class="overview-value success">${completed}</strong>
    </div>
    <div class="overview-card">
      <span class="overview-label">部分完成</span>
      <strong class="overview-value warning">${partial}</strong>
    </div>
    <div class="overview-card">
      <span class="overview-label">失败</span>
      <strong class="overview-value danger">${failed}</strong>
    </div>
    <div class="overview-card is-wide">
      <span class="overview-label">最近一次</span>
      <strong class="overview-value">${escapeHtml(latestCreatedAt)}</strong>
    </div>
  `;
}

function filterHistoryItems(items) {
  const query = elements.historySearch.value.trim().toLowerCase();
  const status = elements.historyStatusFilter.value;

  return items.filter((item) => {
    if (status !== "all" && item.status !== status) {
      return false;
    }

    if (!query) {
      return true;
    }

    const haystack = [
      item.name,
      item.outputDirectory,
      item.error,
      ...(Array.isArray(item.warnings) ? item.warnings : [])
    ].join("\n").toLowerCase();

    return haystack.includes(query);
  });
}

async function openAppLocation(key, label) {
  try {
    const result = await requestJson("/api/system/open-location", {
      method: "POST",
      body: JSON.stringify({ key })
    });
    log(`已打开${label}：${result.path}`);
  } catch (error) {
    throwAndLog(error.message);
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
  const warningSummary = Array.isArray(item.warnings) && item.warnings.length
    ? `<div class="history-alert is-warning">${escapeHtml(item.warnings.join("；"))}</div>`
    : "";
  const errorSummary = item.error
    ? `<div class="history-alert is-error">${escapeHtml(item.error)}</div>`
    : "";
  const taskUrlButton = item.taskUrl
    ? '<button class="button ghost compact" type="button" data-action="open-task-url">打开任务页</button>'
    : "";

  article.innerHTML = `
    <div class="history-compact">
      <div class="history-mainline">
        <strong class="history-main-title">${escapeHtml(item.name || "未命名任务")}</strong>
        <span class="status-chip ${escapeHtml(item.status || "unknown")}">${escapeHtml(statusLabel)}</span>
        <span class="history-inline-meta">${escapeHtml(modeLabel)}</span>
        <span class="history-inline-meta">${escapeHtml(createdAt)}</span>
        <span class="history-inline-meta">${fileCount} 个文件</span>
      </div>
      <div class="history-subline">
        <code class="path-pill compact-path-pill">${escapeHtml(item.outputDirectory || "-")}</code>
        ${item.outputDirectory ? '<button class="button ghost compact" type="button" data-action="open-dir">打开结果目录</button>' : ""}
        ${taskUrlButton}
      </div>
      ${errorSummary}
      ${warningSummary}
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

  const openTaskUrl = async () => {
    if (!item.taskUrl) {
      return;
    }

    await requestJson("/api/system/open-path", {
      method: "POST",
      body: JSON.stringify({ path: item.taskUrl })
    });
  };

  article.querySelector('[data-action="open-dir"]')?.addEventListener("click", openDirectory);
  article.querySelector('[data-action="open-task-url"]')?.addEventListener("click", openTaskUrl);

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
      style: elements.style.value.trim()
    },
    manual: {
      prompt: elements.manualPrompt.value,
      outputDirectory: elements.manualOutput.value.trim(),
      referenceDirectory: elements.manualReferenceDir.value.trim(),
      selectedPromptTemplateId: elements.manualTemplateSelect.value,
      promptTemplates
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

function normalizePromptTemplates(templates) {
  const normalized = Array.isArray(templates)
    ? templates
    .map((template, index) => ({
      id: String(template?.id || `prompt-template-${index + 1}`),
      name: String(template?.name || `提示词 ${index + 1}`),
      content: String(template?.content || "")
    }))
    .filter((template) => template.name.trim())
    : [];

  if (normalized.length > 0) {
    return normalized;
  }

  return [{
    id: "blank-start",
    name: "空白开始",
    content: ""
  }];
}

function renderPromptTemplateOptions(selectedId) {
  const preferredId = promptTemplates.some((template) => template.id === selectedId)
    ? selectedId
    : promptTemplates[0]?.id;

  elements.manualTemplateSelect.innerHTML = promptTemplates.map((template) => `
    <option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}</option>
  `).join("");

  elements.manualTemplateSelect.value = preferredId || "";
}

function renderManualTemplateState() {
  const template = getSelectedPromptTemplate();
  const placeholder = template?.content?.trim()
    ? template.content
    : "直接写下你想让 AnyGen 完成的内容、风格和要求。";

  elements.manualPrompt.placeholder = placeholder;
  if (!template) {
    elements.manualTemplateMeta.textContent = "先选一个提示词模板，下面的内容会自动跟着切换。";
    return;
  }

  elements.manualTemplateMeta.textContent = template.id === "blank-start"
    ? "从空白开始，直接输入你的要求。"
    : `当前已选：${template.name}。你切换模板时，下面的提示词会立刻跟着切换。`;
}

function getSelectedPromptTemplate() {
  const selectedId = elements.manualTemplateSelect.value;
  return promptTemplates.find((template) => template.id === selectedId) || null;
}

async function applySelectedPromptTemplate() {
  const template = getSelectedPromptTemplate();
  if (!template?.content?.trim()) {
    renderManualTemplateState();
    return;
  }

  elements.manualPrompt.value = template.content;
  renderManualTemplateState();
  await saveConfig({ silent: true });
}

function openPromptTemplateModal() {
  elements.templateNameInput.value = "";
  elements.templateContentInput.value = elements.manualPrompt.value.trim();
  if (typeof elements.templateModal.showModal === "function") {
    elements.templateModal.showModal();
  } else {
    elements.templateModal.setAttribute("open", "open");
  }
}

function closePromptTemplateModal() {
  if (typeof elements.templateModal.close === "function") {
    elements.templateModal.close();
  } else {
    elements.templateModal.removeAttribute("open");
  }
}

async function submitPromptTemplate(event) {
  event.preventDefault();

  const name = elements.templateNameInput.value.trim();
  const content = elements.templateContentInput.value.trim();
  if (!name) {
    throwAndLog("请先填写提示词标题。");
    elements.templateNameInput.focus();
    return;
  }
  if (!content) {
    throwAndLog("请先填写提示词内容。");
    elements.templateContentInput.focus();
    return;
  }

  const nextTemplate = {
    id: `prompt-template-${Date.now()}`,
    name,
    content
  };

  promptTemplates = [...promptTemplates, nextTemplate];
  renderPromptTemplateOptions(nextTemplate.id);
  applySelectedPromptTemplate();
  await saveConfig({ silent: true });
  closePromptTemplateModal();
  log(`已新增提示词模板：${nextTemplate.name}`);
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
  const raw = await response.text();
  const json = raw ? safeParseJson(raw) : null;
  if (!response.ok) {
    throw new Error(json?.error || raw || "请求失败。");
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

  if (typeof payload?.completed === "number" || typeof payload?.partial === "number" || typeof payload?.failed === "number") {
    lines.push(`完成 ${payload.completed || 0} / 部分完成 ${payload.partial || 0} / 失败 ${payload.failed || 0}`);
  }

  if (Array.isArray(payload?.warnings) && payload.warnings.length) {
    lines.push(`提醒：${payload.warnings.join("；")}`);
  }

  if (payload?.error) {
    lines.push(`错误：${payload.error}`);
  }

  return lines.join("\n");
}

function formatMode(mode) {
  const labels = {
    manual: "手动任务",
    "manual-batch": "手动批量",
    scheduled: "定时批量",
    "scheduled-batch": "定时批量"
  };

  return labels[mode] || mode || "-";
}

function formatStatus(status) {
  const labels = {
    completed: "已完成",
    partial: "部分完成",
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

function clearStatusLog() {
  elements.statusLog.textContent = "日志已清空。";
}

async function withButtonBusy(button, busyLabel, callback) {
  if (!button) {
    return await callback();
  }

  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;
  try {
    return await callback();
  } finally {
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

async function withRunState(message, callback) {
  activeRuns += 1;
  renderRunState(message);
  try {
    return await callback();
  } finally {
    activeRuns = Math.max(0, activeRuns - 1);
    renderRunState(activeRuns > 0 ? "仍有任务在运行中。" : "当前空闲，可以直接发起任务。");
  }
}

function renderRunState(message) {
  if (!elements.runState) {
    return;
  }

  elements.runState.textContent = message;
  elements.runState.className = `run-state ${activeRuns > 0 ? "is-busy" : "is-idle"}`;
}

function setActiveTab(tabName) {
  const fallbackTab = "compose";
  const nextTab = elements.navLinks.some((button) => button.dataset.tab === tabName) ? tabName : fallbackTab;

  elements.navLinks.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === nextTab);
  });

  elements.viewPanels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.panel === nextTab);
  });

  try {
    window.localStorage.setItem("anygen-active-tab", nextTab);
  } catch {
    // Ignore storage failures and keep the session usable.
  }
}

function readSavedTab() {
  try {
    return window.localStorage.getItem("anygen-active-tab") || "compose";
  } catch {
    return "compose";
  }
}

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
