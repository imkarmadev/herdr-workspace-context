import { generateReport } from "./lib/report.mjs";
import { notify, resolveWorkspace } from "./lib/runtime.mjs";
import {
  refreshContext,
  startDay,
  stopDay,
  workspaceDir,
} from "./lib/state.mjs";

const action = process.argv[2] ?? process.env.HERDR_PLUGIN_ACTION_ID;
const workspace = resolveWorkspace(process.env);

try {
  if (action === "start-day") {
    const result = startDay(workspace);
    notify(
      "Workday tracking",
      result.event ? `Started for ${workspace.label ?? workspace.id}` : "Already active",
    );
  } else if (action === "stop-day") {
    const result = stopDay(workspace);
    notify(
      "Workday tracking",
      result.event ? `Stopped for ${workspace.label ?? workspace.id}` : "Already stopped",
    );
  } else if (action === "generate-report") {
    const result = generateReport({ workspace });
    notify("Daily report generated", result.file, "done");
    process.stdout.write(`${result.file}\n`);
  } else if (action === "refresh-context") {
    refreshContext(workspace);
    const directory = workspaceDir(workspace.id);
    notify("Workspace context refreshed", directory);
  } else {
    throw new Error(`Unknown Workspace Context action: ${action}`);
  }
} catch (error) {
  notify("Workspace Context failed", error.message, "request");
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}
