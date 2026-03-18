import { setTimeout as delay } from "node:timers/promises";

export class AnyGenClient {
  async createTask(options) {
    const baseUrl = options.baseUrl || "https://www.anygen.io";
    const authToken = normalizeBearer(options.apiKey);
    const body = {
      auth_token: authToken,
      operation: options.operation,
      prompt: buildPrompt(options.prompt, options.style)
    };

    if (options.language) {
      body.language = options.language;
    }
    if (options.operation === "slide" && options.slideCount) {
      body.slide_count = Number(options.slideCount);
    }
    if (options.operation === "slide" && options.ratio) {
      body.ratio = options.ratio;
    }
    if (options.operation === "doc" && options.docFormat) {
      body.doc_format = options.docFormat;
    }
    if (options.operation === "smart_draw" && options.smartDrawFormat) {
      body.smart_draw_format = options.smartDrawFormat;
    }
    if (options.referenceFiles?.length) {
      body.files = options.referenceFiles.map((file) => ({
        file_name: file.fileName,
        file_type: file.mimeType,
        file_data: file.buffer.toString("base64")
      }));
    }

    const response = await fetch(`${baseUrl}/v1/openapi/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...options.extraHeaders
      },
      body: JSON.stringify(body)
    });

    const json = await safeJson(response);
    if (!response.ok || !json?.success || !json?.task_id) {
      throw new Error(json?.error || json?.message || `任务创建失败 (${response.status})`);
    }

    return json.task_id;
  }

  async getTask(taskId, options) {
    const baseUrl = options.baseUrl || "https://www.anygen.io";
    const response = await fetch(`${baseUrl}/v1/openapi/tasks/${taskId}`, {
      headers: {
        Authorization: normalizeBearer(options.apiKey),
        ...options.extraHeaders
      }
    });

    const json = await safeJson(response);
    if (!response.ok) {
      throw new Error(json?.error || json?.message || `任务查询失败 (${response.status})`);
    }
    return json;
  }

  async pollTask(taskId, options) {
    const startedAt = Date.now();
    const maxWaitMs = Math.max(60, Number(options.maxPollSeconds || 900)) * 1000;
    const intervalMs = Math.max(2, Number(options.pollIntervalSeconds || 5)) * 1000;

    while (Date.now() - startedAt < maxWaitMs) {
      const task = await this.getTask(taskId, options);
      if (task.status === "completed" || task.status === "failed") {
        return task;
      }
      await delay(intervalMs);
    }

    throw new Error("轮询超时，请稍后在历史记录里查看任务状态。");
  }
}

function normalizeBearer(apiKey) {
  if (!apiKey) {
    throw new Error("请先填写 AnyGen API Key。");
  }
  return apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}`;
}

function buildPrompt(prompt, style) {
  if (!style?.trim()) {
    return prompt;
  }
  return `${prompt}\n\nStyle requirement: ${style.trim()}`;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
