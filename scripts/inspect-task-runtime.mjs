import { promises as fs } from "node:fs";
import path from "node:path";

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const browserPath = await exists(chromePath) ? chromePath : edgePath;
const userDataDir = "D:\\AICode\\anygen-pL\\data\\runtime\\chrome-profile";
const taskUrl = process.argv[2] || "https://www.anygen.io/task/GcnSpH4QOaDEmrgPBtclIgRRgyc";

console.log(JSON.stringify({ browserPath, taskUrl }));

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
