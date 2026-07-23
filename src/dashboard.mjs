import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { generateReport } from "./lib/report.mjs";
import { liveAgents, resolveWorkspace } from "./lib/runtime.mjs";
import {
  addNote,
  addTodo,
  loadState,
  readEvents,
  startDay,
  stopDay,
  toggleTodo,
  workspaceDir,
} from "./lib/state.mjs";

const workspace = resolveWorkspace(process.env);
let agents = [];
let selectedTodo = 0;
let paused = false;
let closed = false;
let refreshTimer = null;
let agentTimer = null;

const color = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  bold: "\u001b[1m",
  green: "\u001b[38;5;121m",
  yellow: "\u001b[38;5;221m",
  red: "\u001b[38;5;203m",
  cyan: "\u001b[38;5;117m",
  gray: "\u001b[38;5;245m",
};

function truncate(text, width) {
  const value = String(text ?? "");
  if (value.length <= width) return value;
  return `${value.slice(0, Math.max(0, width - 1))}…`;
}

function statusColor(status) {
  if (status === "working") return color.green;
  if (status === "blocked") return color.yellow;
  if (status === "done") return color.cyan;
  if (status === "unknown") return color.red;
  return color.gray;
}

function eventLabel(event) {
  if (event.type === "note") return `${event.category}: ${event.text}`;
  if (event.type === "agent_status") {
    return `${event.name ?? event.agent ?? event.paneId} → ${event.status}`;
  }
  if (event.type === "todo_added") return `task added: ${event.text}`;
  if (event.type === "todo_completed") return `task completed: ${event.text}`;
  if (event.type === "todo_reopened") return `task reopened: ${event.text}`;
  if (event.type === "workday_started") return "workday tracking started";
  if (event.type === "workday_stopped") return "workday tracking stopped";
  if (event.type === "workspace_event") return event.message;
  return null;
}

function render() {
  if (paused || closed) return;
  const state = loadState(workspace);
  const events = readEvents(workspace.id).slice(-8).reverse();
  const width = Math.max(60, stdout.columns || 100);
  const lines = [];
  lines.push(
    `${color.bold}${color.green} Workspace Context ${color.reset}${color.dim}│${color.reset} ${
      state.workspace.label ?? workspace.id
    }`,
  );
  lines.push(
    `${color.dim}${truncate(state.workspace.cwd ?? "No directory", width - 2)}${color.reset}`,
  );
  lines.push(
    `${state.tracking.active ? `${color.green}● tracking${color.reset}` : `${color.gray}○ stopped${color.reset}`}  ` +
      `${color.dim}${workspaceDir(workspace.id)}${color.reset}`,
  );
  lines.push("");
  lines.push(`${color.bold}AGENTS${color.reset} ${color.dim}${agents.length}${color.reset}`);
  if (!agents.length) {
    lines.push(`  ${color.dim}No live agents detected. Install Herdr agent integrations.${color.reset}`);
  } else {
    for (const agent of agents.slice(0, 10)) {
      lines.push(
        `  ${statusColor(agent.status)}● ${agent.status.padEnd(8)}${color.reset} ` +
          `${color.bold}${truncate(agent.name, 20).padEnd(20)}${color.reset} ` +
          `${color.dim}${truncate(agent.title ?? agent.cwd ?? "", Math.max(10, width - 38))}${color.reset}`,
      );
    }
  }
  lines.push("");
  lines.push(`${color.bold}SHARED TODO${color.reset} ${color.dim}${state.todos.filter((todo) => !todo.done).length} open${color.reset}`);
  if (!state.todos.length) {
    lines.push(`  ${color.dim}No shared tasks. Press t to add one.${color.reset}`);
  } else {
    state.todos.slice(-10).forEach((todo, index) => {
      const selected = index === selectedTodo ? `${color.cyan}>${color.reset}` : " ";
      lines.push(
        `${selected} ${todo.done ? "[x]" : "[ ]"} ${todo.done ? color.dim : ""}${truncate(todo.text, width - 10)}${color.reset}`,
      );
    });
  }
  lines.push("");
  lines.push(`${color.bold}RECENT ACTIVITY${color.reset}`);
  const visibleEvents = events
    .map((event) => ({ ...event, label: eventLabel(event) }))
    .filter((event) => event.label);
  if (!visibleEvents.length) {
    lines.push(`  ${color.dim}No meaningful activity captured yet.${color.reset}`);
  } else {
    for (const event of visibleEvents.slice(0, 6)) {
      const time = new Date(event.at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      lines.push(
        `  ${color.dim}${time}${color.reset}  ${truncate(event.label, width - 12)}`,
      );
    }
  }
  lines.push("");
  lines.push(
    `${color.dim}q close   s start/stop   n note   t task   ↑↓ select   x toggle   r report${color.reset}`,
  );
  stdout.write(`\u001b[2J\u001b[H${lines.join("\n")}`);
}

async function prompt(question) {
  paused = true;
  if (stdin.isTTY) stdin.setRawMode(false);
  stdout.write("\u001b[2J\u001b[H");
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    return await readline.question(question);
  } finally {
    readline.close();
    if (stdin.isTTY) stdin.setRawMode(true);
    paused = false;
  }
}

async function handleKey(buffer) {
  const key = buffer.toString();
  const state = loadState(workspace);
  if (key === "q" || key === "\u0003" || key === "\u001b") {
    close();
    return;
  }
  if (key === "s") {
    if (state.tracking.active) stopDay(workspace);
    else startDay(workspace);
  } else if (key === "n") {
    const category =
      (await prompt("Category [note/completed/review/decision/in_progress/blocker]: ")).trim() ||
      "note";
    const text = await prompt("What happened? ");
    if (text.trim()) addNote(workspace, category, text);
  } else if (key === "t") {
    const text = await prompt("New shared task: ");
    if (text.trim()) addTodo(workspace, text);
  } else if (key === "x") {
    const visible = state.todos.slice(-10);
    const todo = visible[selectedTodo];
    if (todo) toggleTodo(workspace, todo.id);
  } else if (key === "r") {
    const report = generateReport({ workspace });
    await prompt(`Report generated:\n${report.file}\n\nPress Enter to return.`);
  } else if (key === "\u001b[A" || key === "k") {
    selectedTodo = Math.max(0, selectedTodo - 1);
  } else if (key === "\u001b[B" || key === "j") {
    selectedTodo = Math.min(Math.max(0, state.todos.slice(-10).length - 1), selectedTodo + 1);
  }
  render();
}

function close() {
  closed = true;
  if (refreshTimer) clearInterval(refreshTimer);
  if (agentTimer) clearInterval(agentTimer);
  stdin.off("data", handleKey);
  if (stdin.isTTY) stdin.setRawMode(false);
  stdout.write(`\u001b[?25h\u001b[?1049l${color.reset}`);
  process.exit(0);
}

if (!stdin.isTTY || !stdout.isTTY) {
  const state = loadState(workspace);
  process.stdout.write(`${JSON.stringify({ state, agents: liveAgents(workspace.id) }, null, 2)}\n`);
} else {
  stdout.write("\u001b[?1049h\u001b[?25l");
  stdin.setRawMode(true);
  stdin.resume();
  stdin.on("data", handleKey);
  agents = liveAgents(workspace.id);
  agentTimer = setInterval(() => {
    if (!paused) agents = liveAgents(workspace.id);
  }, 2000);
  refreshTimer = setInterval(render, 1000);
  process.on("SIGTERM", close);
  process.on("SIGHUP", close);
  render();
}
