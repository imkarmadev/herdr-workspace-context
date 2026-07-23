import { captureHerdrEvent } from "./lib/activity.mjs";

try {
  captureHerdrEvent(process.env);
} catch (error) {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}
