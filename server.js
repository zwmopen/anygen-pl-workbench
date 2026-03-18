import { createServerApp, runScheduledOnce } from "./src/app.js";

const shouldRunScheduled = process.argv.includes("--run-scheduled");

if (shouldRunScheduled) {
  try {
    await runScheduledOnce();
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

const port = Number.parseInt(process.env.PORT || "4318", 10);
const host = process.env.HOST || "127.0.0.1";

const { app, scheduler } = await createServerApp();

const server = app.listen(port, host, () => {
  console.log(`AnyGen Workbench running at http://${host}:${port}`);
});

const shutdown = async () => {
  await scheduler.stop();
  server.close(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
