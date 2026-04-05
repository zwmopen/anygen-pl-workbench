import cron from "node-cron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";

export class SchedulerService {
  constructor({ configStore, jobService, projectRoot }) {
    this.configStore = configStore;
    this.jobService = jobService;
    this.projectRoot = projectRoot;
    this.timezone = systemTimeZone;
    this.task = null;
    this.running = false;
  }

  async applyConfig(config) {
    if (this.task) {
      this.task.stop();
      this.task.destroy();
      this.task = null;
    }

    if (!config.scheduler.enabled || !config.scheduler.time) {
      return;
    }

    const [hour, minute] = config.scheduler.time.split(":").map((value) => Number.parseInt(value, 10));
    const expression = `${minute} ${hour} * * *`;

    this.task = cron.schedule(expression, async () => {
      await this.runScheduledBatch();
    }, {
      timezone: this.timezone
    });
  }

  async runScheduledBatch() {
    if (this.running) {
      return { skipped: true, reason: "已有定时任务在运行中" };
    }

    this.running = true;
    try {
      return await this.jobService.runBatchJobs(null, "scheduled");
    } finally {
      this.running = false;
    }
  }

  async registerWindowsTask(config) {
    const time = config.scheduler.time || "09:00";
    const taskName = config.scheduler.taskName || "AnyGen Workbench Daily";
    const command = `cmd /c cd /d "${this.projectRoot}" && "${process.execPath}" server.js --run-scheduled`;

    await execFileAsync("schtasks.exe", [
      "/Create",
      "/TN",
      taskName,
      "/SC",
      "DAILY",
      "/ST",
      time,
      "/TR",
      command,
      "/F"
    ]);

    return { taskName, time, timezone: this.timezone };
  }

  async unregisterWindowsTask(taskName) {
    await execFileAsync("schtasks.exe", [
      "/Delete",
      "/TN",
      taskName,
      "/F"
    ]);
  }

  async stop() {
    if (this.task) {
      this.task.stop();
      this.task.destroy();
      this.task = null;
    }
  }
}
