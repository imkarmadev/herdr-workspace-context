import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const SCHEMA_VERSION = 1;
const sleepArray = new Int32Array(new SharedArrayBuffer(4));

export function stateRoot(env = process.env) {
  const root = env.HERDR_PLUGIN_STATE_DIR || env.WORKSPACE_CONTEXT_STATE_DIR;
  if (!root) {
    throw new Error("HERDR_PLUGIN_STATE_DIR is not set.");
  }
  mkdirSync(root, { recursive: true });
  return root;
}

function safeSegment(value) {
  const safe = String(value ?? "unknown").replace(/[^A-Za-z0-9_-]/g, "_");
  return safe.slice(0, 96) || "unknown";
}

export function workspaceDir(workspaceId, env = process.env) {
  const directory = join(stateRoot(env), "workspaces", safeSegment(workspaceId));
  mkdirSync(directory, { recursive: true });
  return directory;
}

function statePath(workspaceId, env) {
  return join(workspaceDir(workspaceId, env), "state.json");
}

function eventsPath(workspaceId, env) {
  return join(workspaceDir(workspaceId, env), "events.jsonl");
}

function defaultState(workspace) {
  return {
    schemaVersion: SCHEMA_VERSION,
    workspace: {
      id: workspace.id,
      label: workspace.label ?? null,
      cwd: workspace.cwd ?? null,
    },
    tracking: {
      active: false,
      sessions: [],
    },
    agents: {},
    todos: [],
    updatedAt: new Date().toISOString(),
  };
}

function mergeWorkspace(state, workspace) {
  state.workspace = {
    id: workspace.id,
    label: workspace.label ?? state.workspace?.label ?? null,
    cwd: workspace.cwd ?? state.workspace?.cwd ?? null,
  };
}

export function loadState(workspace, env = process.env) {
  const file = statePath(workspace.id, env);
  if (!existsSync(file)) return defaultState(workspace);
  try {
    const state = JSON.parse(readFileSync(file, "utf8"));
    mergeWorkspace(state, workspace);
    state.schemaVersion = SCHEMA_VERSION;
    state.tracking ??= { active: false, sessions: [] };
    state.tracking.sessions ??= [];
    state.agents ??= {};
    state.todos ??= [];
    return state;
  } catch {
    return defaultState(workspace);
  }
}

function atomicWrite(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporary, file);
}

function acquireLock(workspaceId, env) {
  const lock = join(workspaceDir(workspaceId, env), ".lock");
  const deadline = Date.now() + 3000;
  for (;;) {
    try {
      const descriptor = openSync(lock, "wx", 0o600);
      return () => {
        closeSync(descriptor);
        try {
          unlinkSync(lock);
        } catch {
          // A stale-lock recovery may already have removed it.
        }
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lock).mtimeMs > 15_000) unlinkSync(lock);
      } catch {
        // The owner may have released it between stat and unlink.
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for workspace state lock: ${lock}`);
      }
      Atomics.wait(sleepArray, 0, 0, 25);
    }
  }
}

function appendEvent(workspaceId, event, env) {
  const normalized = {
    id: event.id ?? randomUUID(),
    at: event.at ?? new Date().toISOString(),
    ...event,
  };
  appendFileSync(eventsPath(workspaceId, env), `${JSON.stringify(normalized)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return normalized;
}

export function mutateState(workspace, mutation, env = process.env) {
  const release = acquireLock(workspace.id, env);
  try {
    const state = loadState(workspace, env);
    mergeWorkspace(state, workspace);
    const event = mutation(state);
    state.updatedAt = new Date().toISOString();
    atomicWrite(statePath(workspace.id, env), state);
    if (event) appendEvent(workspace.id, event, env);
    writeSharedContext(state, env);
    return { state, event };
  } finally {
    release();
  }
}

export function readEvents(workspaceId, env = process.env) {
  const file = eventsPath(workspaceId, env);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

export function startDay(workspace, env = process.env, at = new Date()) {
  return mutateState(
    workspace,
    (state) => {
      if (state.tracking.active) return null;
      const startedAt = at.toISOString();
      state.tracking.active = true;
      state.tracking.sessions.push({ startedAt, stoppedAt: null });
      return { type: "workday_started", at: startedAt };
    },
    env,
  );
}

export function stopDay(workspace, env = process.env, at = new Date()) {
  return mutateState(
    workspace,
    (state) => {
      if (!state.tracking.active) return null;
      const stoppedAt = at.toISOString();
      state.tracking.active = false;
      const session = [...state.tracking.sessions]
        .reverse()
        .find((item) => !item.stoppedAt);
      if (session) session.stoppedAt = stoppedAt;
      return { type: "workday_stopped", at: stoppedAt };
    },
    env,
  );
}

export function addNote(workspace, category, text, env = process.env) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Note cannot be empty.");
  return mutateState(
    workspace,
    () => ({
      type: "note",
      category,
      text: trimmed,
    }),
    env,
  );
}

export function addTodo(workspace, text, env = process.env) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Task cannot be empty.");
  const todo = {
    id: randomUUID(),
    text: trimmed,
    done: false,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  return mutateState(
    workspace,
    (state) => {
      state.todos.push(todo);
      return { type: "todo_added", todoId: todo.id, text: todo.text };
    },
    env,
  );
}

export function toggleTodo(workspace, todoId, env = process.env) {
  return mutateState(
    workspace,
    (state) => {
      const todo = state.todos.find((item) => item.id === todoId);
      if (!todo) return null;
      todo.done = !todo.done;
      todo.completedAt = todo.done ? new Date().toISOString() : null;
      return {
        type: todo.done ? "todo_completed" : "todo_reopened",
        todoId: todo.id,
        text: todo.text,
      };
    },
    env,
  );
}

export function recordAgentStatus(workspace, agent, env = process.env) {
  return mutateState(
    workspace,
    (state) => {
      const previous = state.agents[agent.paneId];
      state.agents[agent.paneId] = {
        ...previous,
        ...agent,
        updatedAt: agent.at ?? new Date().toISOString(),
      };
      if (
        previous?.status === agent.status &&
        previous?.title === agent.title &&
        previous?.name === agent.name
      ) {
        return null;
      }
      return {
        type: "agent_status",
        at: agent.at,
        paneId: agent.paneId,
        agent: agent.agent ?? null,
        name: agent.name ?? agent.agent ?? agent.paneId,
        status: agent.status,
        title: agent.title ?? null,
      };
    },
    env,
  );
}

export function recordEvent(workspace, event, env = process.env) {
  return mutateState(workspace, () => event, env);
}

export function contextMarkdown(state, events = []) {
  const openTodos = state.todos.filter((todo) => !todo.done);
  const completedTodos = state.todos.filter((todo) => todo.done).slice(-10);
  const agents = Object.values(state.agents);
  const notes = events.filter((event) => event.type === "note").slice(-30);
  const decisions = notes.filter((note) => note.category === "decision");
  const blockers = notes.filter((note) => note.category === "blocker");
  const workNotes = notes.filter((note) =>
    ["completed", "review", "in_progress", "note"].includes(note.category),
  );
  const lines = [
    "# Workspace Context",
    "",
    `Workspace: ${state.workspace.label ?? state.workspace.id}`,
    state.workspace.cwd ? `Directory: ${state.workspace.cwd}` : null,
    `Updated: ${state.updatedAt}`,
    "",
    "## Open tasks",
    "",
    ...(openTodos.length
      ? openTodos.map((todo) => `- [ ] ${todo.text}`)
      : ["- No open tasks."]),
    "",
    "## Recently completed",
    "",
    ...(completedTodos.length
      ? completedTodos.map((todo) => `- [x] ${todo.text}`)
      : ["- Nothing completed yet."]),
    "",
    "## Decisions",
    "",
    ...(decisions.length
      ? decisions.map((note) => `- ${note.text}`)
      : ["- No decisions recorded."]),
    "",
    "## Blockers",
    "",
    ...(blockers.length
      ? blockers.map((note) => `- ${note.text}`)
      : ["- No blockers recorded."]),
    "",
    "## Recent work notes",
    "",
    ...(workNotes.length
      ? workNotes.map((note) => `- **${note.category}:** ${note.text}`)
      : ["- No work notes recorded."]),
    "",
    "## Agents",
    "",
    ...(agents.length
      ? agents.map(
          (agent) =>
            `- ${agent.name ?? agent.agent ?? agent.paneId}: ${agent.status}${
              agent.title ? ` — ${agent.title}` : ""
            }`,
        )
      : ["- No agents observed yet."]),
    "",
  ];
  return lines.filter((line) => line !== null).join("\n");
}

export function writeSharedContext(state, env = process.env) {
  const file = join(workspaceDir(state.workspace.id, env), "context.md");
  const events = readEvents(state.workspace.id, env);
  writeFileSync(file, `${contextMarkdown(state, events)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return file;
}

export function refreshContext(workspace, env = process.env) {
  return mutateState(workspace, () => null, env);
}
