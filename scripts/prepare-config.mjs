import { ConfigStore } from "../src/services/config-store.js";

const store = new ConfigStore();
await store.init();
const config = await store.getConfig();
await store.saveConfig(config);

console.log("config-ready");
