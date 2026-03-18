import path from "node:path";
import { fileURLToPath } from "node:url";
import { AnyGenClient } from "../src/services/anygen-client.js";
import { ConfigStore } from "../src/services/config-store.js";
import { JobService } from "../src/services/job-service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const configStore = new ConfigStore();
await configStore.init();

const config = await configStore.getConfig();
if (!config.anygen.apiKey) {
  throw new Error("没有检测到 AnyGen API Key，无法执行自测。");
}

const anygenClient = new AnyGenClient();
const jobService = new JobService({ configStore, anygenClient });
await jobService.init();

const outputDirectory = path.join(projectRoot, "data", "smoke-test");

const result = await jobService.runManualJob({
  name: "smoke-test",
  prompt: "请生成一份简短的测试文档，标题为《AnyGen 已成功连通》，正文控制在120字内，并附上一个简洁的小结。",
  operation: "doc",
  outputDirectory
});

console.log(JSON.stringify({
  status: result.status,
  taskId: result.taskId,
  taskUrl: result.taskUrl,
  outputDirectory,
  files: result.files
}, null, 2));
