import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { addNote } from "./lib/state.mjs";
import { resolveWorkspace } from "./lib/runtime.mjs";

const categories = {
  "1": "completed",
  "2": "review",
  "3": "decision",
  "4": "in_progress",
  "5": "blocker",
  "6": "note",
};

const workspace = resolveWorkspace(process.env);
const readline = createInterface({ input, output });

try {
  output.write(`\nWorkspace Context — ${workspace.label ?? workspace.id}\n\n`);
  output.write(
    "1 completed   2 review   3 decision   4 in progress   5 blocker   6 note\n\n",
  );
  const choice = (await readline.question("Type [6]: ")).trim() || "6";
  const category = categories[choice] ?? choice;
  const text = await readline.question("What happened? ");
  addNote(workspace, category, text);
  output.write("\nSaved. This entry will be included in the daily report.\n");
} catch (error) {
  output.write(`\nCould not save note: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  readline.close();
}
