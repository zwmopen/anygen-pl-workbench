const elements = {
  apiKey: document.querySelector("#api-key"),
  operation: document.querySelector("#operation"),
  manualTemplateSelect: document.querySelector("#manual-template-select"),
  manualTemplateMeta: document.querySelector("#manual-template-meta"),
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
  statusSummary: document.querySelector("#status-summary"),
  historyOverview: document.querySelector("#history-overview"),
  historySearch: document.querySelector("#history-search"),
  historyStatusFilter: document.querySelector("#history-status-filter"),
  historyList: document.querySelector("#history-list"),
  recentResults: document.querySelector("#recent-results"),
  runState: document.querySelector("#run-state"),
  statusLog: document.querySelector("#status-log"),
  settingsDrawer: document.querySelector("#settings-drawer"),
  toolsDrawer: document.querySelector("#tools-drawer"),
  settingsUpdateDot: document.querySelector("#settings-update-dot"),
  currentVersionLabel: document.querySelector("#current-version-label"),
  latestVersionLabel: document.querySelector("#latest-version-label"),
  updateStatusNote: document.querySelector("#update-status-note"),
  accountAutoCheckIn: document.querySelector("#account-auto-checkin"),
  accountSessionStatus: document.querySelector("#account-session-status"),
  accountCheckInStatus: document.querySelector("#account-checkin-status"),
  accountCreditsStatus: document.querySelector("#account-credits-status"),
  accountStatusNote: document.querySelector("#account-status-note"),
  templateModal: document.querySelector("#template-modal"),
  templateLibraryList: document.querySelector("#template-library-list"),
  templateForm: document.querySelector("#template-form"),
  templateNameInput: document.querySelector("#template-name-input"),
  templateContentInput: document.querySelector("#template-content-input"),
  submitTemplateModal: document.querySelector("#submit-template-modal")
};

let promptTemplates = [];
let latestDiagnostics = null;
let historyItemsCache = [];
let latestAccountStatus = null;
let latestUpdateStatus = null;
let activeRuns = 0;
let editingTemplateId = null;

boot();

async function boot() {
  bindEvents();
  await hydrateConfig();
  await refreshDiagnostics();
  await refreshUpdateStatus();
  await refreshAccountStatus();
  await refreshHistory();
}

function bindEvents() {
  document.querySelector("#open-settings")?.addEventListener("click", async () => {
    openDrawer(elements.settingsDrawer);
    await refreshUpdateStatus();
    await refreshAccountStatus();
  });
  document.querySelector("#open-tools")?.addEventListener("click", () => openDrawer(elements.toolsDrawer));
  document.querySelector("#save-config")?.addEventListener("click", saveConfig);
  document.querySelector("#run-manual")?.addEventListener("click", runManual);
  document.querySelector("#run-batch")?.addEventListener("click", runBatch);
  document.querySelector("#run-schedule-now")?.addEventListener("click", runScheduleNow);
  document.querySelector("#register-task")?.addEventListener("click", registerSystemTask);
  document.querySelector("#refresh-history")?.addEventListener("click", refreshHistory);
  document.querySelector("#show-history")?.addEventListener("click", () => {
    document.querySelector(".history-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.querySelector("#open-template-modal")?.addEventListener("click", openPromptTemplateModal);
  document.querySelector("#cancel-template-modal")?.addEventListener("click", closePromptTemplateModal);
  document.querySelector("#close-template-modal-top")?.addEventListener("click", closePromptTemplateModal);
  document.querySelector("#clear-status-log")?.addEventListener("click", clearStatusLog);
  document.querySelector("#open-account-window")?.addEventListener("click", openAccountWindow);
  document.querySelector("#check-in-account")?.addEventListener("click", checkInAccount);
  document.querySelector("#refresh-account-status")?.addEventListener("click", refreshAccountStatus);
  document.querySelector("#logout-account")?.addEventListener("click", logoutAccountSession);
  document.querySelector("#refresh-update-status")?.addEventListener("click", refreshUpdateStatus);
  document.querySelector("#open-release-page")?.addEventListener("click", openReleasePage);

  elements.manualTemplateSelect?.addEventListener("change", applySelectedPromptTemplate);
  elements.templateForm?.addEventListener("submit", submitPromptTemplate);
  elements.historySearch?.addEventListener("input", renderHistoryList);
  elements.historyStatusFilter?.addEventListener("change", renderHistoryList);

  document.querySelectorAll("[data-pick]").forEach((button) => {
    button.addEventListener("click", async () => {
      const targetId = button.dataset.pick;
      const kind = button.dataset.kind;
      const filter = button.dataset.filter;
      const input = document.querySelector(`#${targetId}`);
      const initialPath = input?.value?.trim() || "";

      const result = kind === "file"
        ? await requestJson("/api/system/pick-file", {
            method: "POST",
            body: JSON.stringify({ filter, initialPath })
          })
        : await requestJson("/api/system/pick-folder", {
            method: "POST",
            body: JSON.stringify({ initialPath })
          });

      if (!result?.path || !input) {
        return;
      }

      input.value = result.path;
      await saveConfig({ silent: true, skipRefreshHistory: true });
      await refreshDiagnostics();
    });
  });

  [
    elements.manualOutput,
    elements.manualReferenceDir,
    elements.batchSource,
    elements.batchSheet
  ].forEach((input) => {
    input?.addEventListener("change", () => saveConfig({ silent: true, skipRefreshHistory: true }));
    input?.addEventListener("blur", () => saveConfig({ silent: true, skipRefreshHistory: true }));
  });

  document.querySelectorAll("[data-clear]").forEach((button) => {
    button.addEventListener("click", async () => {
      const targetId = button.dataset.clear;
      const input = document.querySelector(`#${targetId}`);
      if (!input) {
        return;
      }

      input.value = "";
      await saveConfig({ silent: true, skipRefreshHistory: true });
      await refreshDiagnostics();
    });
  });

  document.querySelectorAll("[data-reset]").forEach((button) => {
    button.addEventListener("click", async () => {
      const targetId = button.dataset.reset;
      const input = document.querySelector(`#${targetId}`);
      if (!input) {
        return;
      }

      if (targetId === "manual-output") {
        input.value = latestDiagnostics?.defaults?.downloadsDirectory || "";
      }

      await saveConfig({ silent: true, skipRefreshHistory: true });
      await refreshDiagnostics();
    });
  });

  document.querySelectorAll("[data-close-drawer]").forEach((button) => {
    button.addEventListener("click", () => {
      const drawer = document.querySelector(`#${button.dataset.closeDrawer}`);
      closeDrawer(drawer);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }
    closeDrawer(elements.settingsDrawer);
    closeDrawer(elements.toolsDrawer);
    closePromptTemplateModal();
  });

  elements.templateModal?.addEventListener("click", (event) => {
    const rect = elements.templateModal.getBoundingClientRect();
    const clickedOutside = (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    );

    if (clickedOutside) {
      closePromptTemplateModal();
    }
  });
}

async function hydrateConfig() {
  const config = await requestJson("/api/config");
  elements.apiKey.value = config.anygen.apiKey || "";
  elements.operation.value = config.anygen.operation || "chat";

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
  elements.accountAutoCheckIn.checked = Boolean(config.account?.autoCheckIn);

  renderManualTemplateState();
  renderTemplateLibrary();
}

async function saveConfig(options = {}) {
  const { silent = false, skipRefreshHistory = false } = options;
  await withButtonBusy(document.querySelector("#save-config"), "保存中…", async () => {
    await requestJson("/api/config", {
      method: "POST",
      body: JSON.stringify(collectConfigPayload())
    });
  });

  await refreshDiagnostics();
  await refreshUpdateStatus();
  await refreshAccountStatus();
  if (!skipRefreshHistory) {
    await refreshHistory();
  }

  if (!silent) {
    log("设置已保存。");
  }
}

async function runManual() {
  const prompt = elements.manualPrompt.value.trim();
  if (!prompt) {
    notifyError("先写下这次想生成的内容。");
    return;
  }

  await withRunState("正在生成，这一轮完成后会自动出现在最近结果里。", async () => {
    await withButtonBusy(document.querySelector("#run-manual"), "生成中…", async () => {
      await saveConfig({ silent: true, skipRefreshHistory: true });

      const formData = new FormData();
      formData.append("name", buildManualJobName(prompt));
      formData.append("prompt", prompt);
      formData.append("operation", elements.operation.value);
      formData.append("outputDirectory", elements.manualOutput.value.trim());
      formData.append("referenceDirectory", elements.manualReferenceDir.value.trim());

      Array.from(elements.manualFiles.files || []).forEach((file) => {
        formData.append("referenceFiles", file);
      });

      log("手动任务已发出，正在等待 AnyGen 返回结果。");

      try {
        const result = await requestJson("/api/manual/run", {
          method: "POST",
          body: formData
        }, false);

        log(formatSummary("本次生成完成", result));
        await refreshHistory();
      } catch (error) {
        notifyError(error.message);
      }
    });
  });
}

async function runBatch() {
  await withRunState("批量任务运行中，处理完成后会自动刷新记录。", async () => {
    await withButtonBusy(document.querySelector("#run-batch"), "运行中…", async () => {
      await saveConfig({ silent: true, skipRefreshHistory: true });
      log("批量任务开始执行。");

      try {
        const result = await requestJson("/api/batch/run", { method: "POST" });
        log(formatSummary("批量任务完成", result));
        await refreshHistory();
        closeDrawer(elements.toolsDrawer);
        document.querySelector(".history-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (error) {
        notifyError(error.message);
      }
    });
  });
}

async function runScheduleNow() {
  await withRunState("正在立即执行一轮定时任务。", async () => {
    await withButtonBusy(document.querySelector("#run-schedule-now"), "执行中…", async () => {
      await saveConfig({ silent: true, skipRefreshHistory: true });
      log("开始立即执行定时任务。");

      try {
        const result = await requestJson("/api/scheduler/run-now", { method: "POST" });
        log(formatSummary("定时任务完成", result));
        await refreshHistory();
      } catch (error) {
        notifyError(error.message);
      }
    });
  });
}

async function registerSystemTask() {
  await withButtonBusy(document.querySelector("#register-task"), "注册中…", async () => {
    await saveConfig({ silent: true, skipRefreshHistory: true });

    try {
      const result = await requestJson("/api/system/register-task", { method: "POST" });
      log(`已注册系统定时任务：${result.taskName}，每天 ${result.time} 运行。`);
    } catch (error) {
      notifyError(error.message);
    }
  });
}

async function refreshDiagnostics() {
  latestDiagnostics = await requestJson("/api/system/diagnostics");
  renderStatusSummary(latestDiagnostics);
}

async function refreshUpdateStatus() {
  try {
    latestUpdateStatus = await requestJson("/api/system/update-status");
    renderUpdateStatus(latestUpdateStatus);
  } catch (error) {
    notifyError(error.message);
  }
}

async function refreshAccountStatus() {
  try {
    latestAccountStatus = await requestJson("/api/account/status");
    renderAccountStatus(latestAccountStatus);
  } catch (error) {
    notifyError(error.message);
  }
}

async function openReleasePage() {
  const releaseUrl = latestUpdateStatus?.releaseUrl;
  if (!releaseUrl) {
    notifyError("还没有拿到发布页地址。");
    return;
  }

  try {
    await openPath(releaseUrl);
  } catch (error) {
    notifyError(error.message);
  }
}

async function openAccountWindow() {
  try {
    await withButtonBusy(document.querySelector("#open-account-window"), "打开中…", async () => {
      await requestJson("/api/account/open", { method: "POST" });
    });
    log("已打开 AnyGen 网页账号窗口。");
  } catch (error) {
    notifyError(error.message);
  }
}

async function checkInAccount() {
  try {
    await withButtonBusy(document.querySelector("#check-in-account"), "签到中…", async () => {
      latestAccountStatus = await requestJson("/api/account/check-in", { method: "POST" });
    });
    renderAccountStatus(latestAccountStatus);
    log(latestAccountStatus?.lastCheckInMessage || "已尝试签到。");
  } catch (error) {
    notifyError(error.message);
  }
}

async function logoutAccountSession() {
  try {
    await withButtonBusy(document.querySelector("#logout-account"), "退出中…", async () => {
      latestAccountStatus = await requestJson("/api/account/logout", { method: "POST" });
    });
    renderAccountStatus(latestAccountStatus);
    log("已清除网页登录状态。");
  } catch (error) {
    notifyError(error.message);
  }
}

async function refreshHistory() {
  historyItemsCache = await requestJson("/api/history");
  renderHistoryOverview(historyItemsCache);
  renderRecentResults(historyItemsCache);
  renderHistoryList();
}

function renderStatusSummary(diagnostics) {
  if (!elements.statusSummary) {
    return;
  }

  const apiReady = Boolean(diagnostics?.config?.apiKeyConfigured);
  const saveDir = diagnostics?.paths?.manualOutputDirectory || diagnostics?.defaults?.downloadsDirectory || "下载目录";
  const mode = formatOperation(diagnostics?.config?.operation || "chat");

  if (!apiReady) {
    elements.statusSummary.textContent = "先在设置里填 API Key，填完就可以直接生成。";
    return;
  }

  elements.statusSummary.textContent = `已就绪。默认按“${mode}”处理，结果会保存到 ${saveDir}。`;
}

function renderAccountStatus(status) {
  if (!elements.accountSessionStatus) {
    return;
  }

  if (!status?.supported) {
    elements.accountSessionStatus.textContent = "仅桌面客户端支持";
    elements.accountCheckInStatus.textContent = "不可用";
    elements.accountCreditsStatus.textContent = "不可用";
    elements.accountStatusNote.textContent = "网页登录、签到和积分显示只在客户端里可用。";
    return;
  }

  const sessionLabel = status.sessionReady ? "已连接" : "未登录";
  const checkInLabel = formatAccountCheckInStatus(status);
  const creditsLabel = status.creditsText || "官网暂未给出可识别积分";
  const noteParts = [];

  if (!status.sessionReady) {
    noteParts.push("先点“登录网页账号”，完成网页登录后客户端才会记住会话。");
  } else {
    noteParts.push("网页登录态已保存，关闭客户端后下次仍会继续尝试使用。");
  }

  if (status.profileLabel) {
    noteParts.push(`网页识别到：${status.profileLabel}`);
  }
  if (status.checkInHint) {
    noteParts.push(`签到入口线索：${status.checkInHint}`);
  }

  elements.accountSessionStatus.textContent = sessionLabel;
  elements.accountCheckInStatus.textContent = checkInLabel;
  elements.accountCreditsStatus.textContent = creditsLabel;
  elements.accountStatusNote.textContent = noteParts.join(" ");
}

function renderUpdateStatus(status) {
  if (!elements.currentVersionLabel) {
    return;
  }

  const currentVersion = status?.currentVersion || "-";
  const latestVersion = status?.latestVersion || currentVersion;
  const hasUpdate = Boolean(status?.hasUpdate);
  const checkedAt = status?.checkedAt ? new Date(status.checkedAt).toLocaleString("zh-CN", { hour12: false }) : "";

  elements.currentVersionLabel.textContent = `v${currentVersion}`;
  elements.latestVersionLabel.textContent = hasUpdate ? `v${latestVersion}` : `已是最新`;
  elements.settingsUpdateDot.hidden = !hasUpdate;

  if (status?.error) {
    elements.updateStatusNote.textContent = `刚刚检查失败：${status.error}`;
    return;
  }

  if (hasUpdate) {
    elements.updateStatusNote.textContent = checkedAt
      ? `发现新版本 v${latestVersion}，已在设置按钮上提醒。上次检查：${checkedAt}`
      : `发现新版本 v${latestVersion}。`;
    return;
  }

  elements.updateStatusNote.textContent = checkedAt
    ? `当前已经是最新版本。上次检查：${checkedAt}`
    : "当前已经是最新版本。";
}

function renderHistoryOverview(items) {
  if (!Array.isArray(items) || items.length === 0) {
    elements.historyOverview.innerHTML = `
      <div class="overview-card empty-overview">
        <strong>还没有任务记录</strong>
        <p>第一次生成完成后，这里会显示最近的结果和状态。</p>
      </div>
    `;
    return;
  }

  const completed = items.filter((item) => item.status === "completed").length;
  const partial = items.filter((item) => item.status === "partial").length;
  const failed = items.filter((item) => item.status === "failed").length;

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
  `;
}

function renderRecentResults(items) {
  if (!Array.isArray(items) || items.length === 0) {
    elements.recentResults.innerHTML = `
      <div class="empty-state">
        <strong>还没有最近结果</strong>
        <p>点一次“立即生成”，这块就会出现最新的输出目录和文件数。</p>
      </div>
    `;
    return;
  }

  elements.recentResults.innerHTML = "";
  items.slice(0, 3).forEach((item) => {
    const article = document.createElement("article");
    article.className = "recent-item";

    article.innerHTML = `
      <div class="recent-main">
        <div>
          <strong>${escapeHtml(item.name || "未命名任务")}</strong>
          <p>${escapeHtml(formatStatus(item.status))} · ${escapeHtml(formatMode(item.mode))}</p>
        </div>
        <span class="status-chip ${escapeHtml(item.status || "unknown")}">${escapeHtml(formatStatus(item.status))}</span>
      </div>
      <code class="path-pill">${escapeHtml(item.outputDirectory || "-")}</code>
      <div class="button-row">
        ${item.outputDirectory ? '<button class="button ghost compact" type="button" data-action="open-dir">打开结果</button>' : ""}
        ${item.taskUrl ? '<button class="button ghost compact" type="button" data-action="open-task">打开任务页</button>' : ""}
      </div>
    `;

    article.querySelector('[data-action="open-dir"]')?.addEventListener("click", () => openPath(item.outputDirectory));
    article.querySelector('[data-action="open-task"]')?.addEventListener("click", () => openPath(item.taskUrl));
    elements.recentResults.appendChild(article);
  });
}

function renderHistoryList() {
  const items = filterHistoryItems(historyItemsCache);
  elements.historyList.innerHTML = "";

  if (!items.length) {
    const hasFilters = Boolean(elements.historySearch.value.trim()) || elements.historyStatusFilter.value !== "all";
    elements.historyList.innerHTML = `
      <div class="empty-state">
        <strong>${hasFilters ? "没有匹配的记录" : "还没有任务记录"}</strong>
        <p>${hasFilters ? "换一个关键词或状态试试。" : "先跑一次生成或批量任务，这里会显示结果目录、文件数和错误信息。"}</p>
      </div>
    `;
    return;
  }

  items.slice(0, 30).forEach((item) => {
    elements.historyList.appendChild(renderHistoryItem(item));
  });
}

function renderHistoryItem(item) {
  const article = document.createElement("article");
  article.className = "history-item";

  const fileCount = Array.isArray(item.files) ? item.files.length : 0;
  const createdAt = item.createdAt
    ? new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false })
    : "-";
  const warningSummary = Array.isArray(item.warnings) && item.warnings.length
    ? `<div class="history-alert is-warning">${escapeHtml(item.warnings.join("；"))}</div>`
    : "";
  const errorSummary = item.error
    ? `<div class="history-alert is-error">${escapeHtml(item.error)}</div>`
    : "";

  article.innerHTML = `
    <div class="history-mainline">
      <strong class="history-main-title">${escapeHtml(item.name || "未命名任务")}</strong>
      <span class="status-chip ${escapeHtml(item.status || "unknown")}">${escapeHtml(formatStatus(item.status))}</span>
      <span class="history-inline-meta">${escapeHtml(formatMode(item.mode))}</span>
      <span class="history-inline-meta">${escapeHtml(createdAt)}</span>
      <span class="history-inline-meta">${fileCount} 个文件</span>
    </div>
    <div class="history-subline">
      <code class="path-pill compact-path-pill">${escapeHtml(item.outputDirectory || "-")}</code>
      ${item.outputDirectory ? '<button class="button ghost compact" type="button" data-action="open-dir">打开结果</button>' : ""}
      ${item.taskUrl ? '<button class="button ghost compact" type="button" data-action="open-task">任务页</button>' : ""}
    </div>
    ${errorSummary}
    ${warningSummary}
    ${renderFileList(item.files)}
  `;

  article.querySelector('[data-action="open-dir"]')?.addEventListener("click", () => openPath(item.outputDirectory));
  article.querySelector('[data-action="open-task"]')?.addEventListener("click", () => openPath(item.taskUrl));
  return article;
}

function renderFileList(files = []) {
  if (!Array.isArray(files) || files.length === 0) {
    return "";
  }

  const visibleFiles = files
    .slice(0, 8)
    .map((filePath) => `<div class="history-file">${escapeHtml(filePath)}</div>`)
    .join("");

  const more = files.length > 8
    ? `<div class="history-file">还有 ${files.length - 8} 个文件未展开显示</div>`
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
      operation: elements.operation.value,
      language: "zh-CN",
      style: ""
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
    },
    account: {
      autoCheckIn: elements.accountAutoCheckIn.checked
    }
  };
}

function normalizePromptTemplates(templates) {
  return Array.isArray(templates)
    ? templates
      .map((template, index) => ({
        id: String(template?.id || `prompt-template-${index + 1}`),
        name: String(template?.name || `模板 ${index + 1}`),
        content: String(template?.content || "")
      }))
      .filter((template) => template.name.trim())
    : [];
}

function renderPromptTemplateOptions(selectedId) {
  if (promptTemplates.length === 0) {
    elements.manualTemplateSelect.innerHTML = '<option value="">暂无模板</option>';
    elements.manualTemplateSelect.value = "";
    return;
  }

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
    elements.manualTemplateMeta.textContent = promptTemplates.length === 0
      ? "还没有模板。你可以点右侧“管理模板”添加。"
      : "选一个模板后，下方内容会立即切换。";
    return;
  }

  elements.manualTemplateMeta.textContent = `当前已选：${template.name}。切换模板时，下方内容会同步切换。`;
}

function getSelectedPromptTemplate() {
  const selectedId = elements.manualTemplateSelect.value;
  return promptTemplates.find((template) => template.id === selectedId) || null;
}

async function applySelectedPromptTemplate() {
  const template = getSelectedPromptTemplate();
  if (template?.content?.trim()) {
    elements.manualPrompt.value = template.content;
  }
  renderManualTemplateState();
  await saveConfig({ silent: true, skipRefreshHistory: true });
}

function openPromptTemplateModal() {
  resetTemplateForm();
  renderTemplateLibrary();

  if (typeof elements.templateModal.showModal === "function") {
    elements.templateModal.showModal();
  } else {
    elements.templateModal.setAttribute("open", "open");
  }
}

function closePromptTemplateModal() {
  if (!elements.templateModal?.hasAttribute("open")) {
    return;
  }

  if (typeof elements.templateModal.close === "function") {
    elements.templateModal.close();
  } else {
    elements.templateModal.removeAttribute("open");
  }
  resetTemplateForm();
}

async function submitPromptTemplate(event) {
  event.preventDefault();

  const name = elements.templateNameInput.value.trim();
  const content = elements.templateContentInput.value.trim();
  if (!name) {
    notifyError("先填模板名称。");
    elements.templateNameInput.focus();
    return;
  }
  if (!content) {
    notifyError("先填模板内容。");
    elements.templateContentInput.focus();
    return;
  }

  const wasEditing = Boolean(editingTemplateId);
  if (editingTemplateId) {
    promptTemplates = promptTemplates.map((template) => (
      template.id === editingTemplateId
        ? { ...template, name, content }
        : template
    ));
  } else {
    const nextTemplate = {
      id: `prompt-template-${Date.now()}`,
      name,
      content
    };
    promptTemplates = [...promptTemplates, nextTemplate];
    editingTemplateId = nextTemplate.id;
  }

  renderPromptTemplateOptions(editingTemplateId);
  renderTemplateLibrary();
  elements.manualPrompt.value = content;
  renderManualTemplateState();
  await saveConfig({ silent: true, skipRefreshHistory: true });
  log(`${wasEditing ? "已保存模板" : "已新增模板"}：${name}`);
  resetTemplateForm();
}

function renderTemplateLibrary() {
  if (!elements.templateLibraryList) {
    return;
  }

  if (promptTemplates.length === 0) {
    elements.templateLibraryList.innerHTML = `
      <div class="empty-state compact-empty">
        <strong>还没有模板</strong>
        <p>在下方填名称和内容，就能新增一个模板。</p>
      </div>
    `;
    return;
  }

  elements.templateLibraryList.innerHTML = "";
  promptTemplates.forEach((template) => {
    const article = document.createElement("article");
    article.className = "template-library-item";
    article.innerHTML = `
      <div class="template-library-copy">
        <strong>${escapeHtml(template.name)}</strong>
        <p>${escapeHtml(summarizeTemplate(template.content))}</p>
      </div>
      <div class="button-row">
        <button class="button ghost compact" type="button" data-edit-template="${escapeHtml(template.id)}">编辑</button>
        <button class="button ghost compact subtle" type="button" data-delete-template="${escapeHtml(template.id)}">删除</button>
      </div>
    `;

    article.querySelector("[data-edit-template]")?.addEventListener("click", () => startEditTemplate(template.id));
    article.querySelector("[data-delete-template]")?.addEventListener("click", async () => {
      await deleteTemplate(template.id);
    });
    elements.templateLibraryList.appendChild(article);
  });
}

function startEditTemplate(templateId) {
  const template = promptTemplates.find((item) => item.id === templateId);
  if (!template) {
    return;
  }

  editingTemplateId = template.id;
  elements.templateNameInput.value = template.name;
  elements.templateContentInput.value = template.content;
  if (elements.submitTemplateModal) {
    elements.submitTemplateModal.textContent = "保存修改";
  }
}

async function deleteTemplate(templateId) {
  const wasSelected = elements.manualTemplateSelect.value === templateId;
  const nextTemplates = promptTemplates.filter((template) => template.id !== templateId);
  promptTemplates = nextTemplates;

  const nextSelectedId = wasSelected
    ? (nextTemplates[0]?.id || "")
    : elements.manualTemplateSelect.value;

  renderPromptTemplateOptions(nextSelectedId);
  if (wasSelected) {
    elements.manualPrompt.value = nextTemplates.find((template) => template.id === nextSelectedId)?.content || "";
  }
  renderTemplateLibrary();
  renderManualTemplateState();

  if (editingTemplateId === templateId) {
    resetTemplateForm();
  }

  await saveConfig({ silent: true, skipRefreshHistory: true });
}

function resetTemplateForm() {
  editingTemplateId = null;
  elements.templateNameInput.value = "";
  elements.templateContentInput.value = elements.manualPrompt.value.trim();
  if (elements.submitTemplateModal) {
    elements.submitTemplateModal.textContent = "新增模板";
  }
}

function summarizeTemplate(content) {
  const summary = String(content || "").replace(/\s+/g, " ").trim();
  return summary.length > 60 ? `${summary.slice(0, 60)}…` : summary || "空白模板";
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

async function openPath(pathValue) {
  if (!pathValue) {
    return;
  }

  await requestJson("/api/system/open-path", {
    method: "POST",
    body: JSON.stringify({ path: pathValue })
  });
}

function openDrawer(drawer) {
  if (!drawer) {
    return;
  }
  drawer.classList.add("is-open");
  drawer.setAttribute("aria-hidden", "false");
}

function closeDrawer(drawer) {
  if (!drawer) {
    return;
  }
  drawer.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
}

function log(message) {
  const timestamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  elements.statusLog.textContent = `[${timestamp}] ${message}\n\n${elements.statusLog.textContent}`.trim();
}

function notifyError(message) {
  log(`出错：${message}`);
}

function clearStatusLog() {
  elements.statusLog.textContent = "日志已清空。";
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
    scheduled: "定时任务",
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

function formatAccountCheckInStatus(status) {
  const code = status?.lastCheckInStatus || "";
  const date = status?.lastCheckInDate || "";
  const labels = {
    success: date ? `${date} 已尝试` : "已尝试",
    not_logged_in: "未登录",
    button_not_found: "没识别到签到按钮",
    failed: "上次失败"
  };

  return labels[code] || (status?.lastCheckInMessage ? "有记录" : "暂未记录");
}

function formatOperation(operation) {
  const labels = {
    chat: "通用对话",
    doc: "文档生成",
    slide: "幻灯片生成",
    storybook: "故事板",
    data_analysis: "数据分析",
    website: "网站生成",
    smart_draw: "图表绘制"
  };

  return labels[operation] || operation || "通用对话";
}

function buildManualJobName(prompt) {
  const firstLine = prompt.split(/\r?\n/).find(Boolean) || "手动任务";
  return firstLine.slice(0, 24).trim() || "手动任务";
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
    renderRunState(activeRuns > 0 ? "仍有任务在运行中。" : "当前空闲，可以直接开始。");
  }
}

function renderRunState(message) {
  if (!elements.runState) {
    return;
  }

  elements.runState.textContent = message;
  elements.runState.className = `run-state ${activeRuns > 0 ? "is-busy" : "is-idle"}`;
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
