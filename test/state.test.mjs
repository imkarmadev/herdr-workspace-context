import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  addNote,
  addTodo,
  loadState,
  readEvents,
  recordAgentStatus,
  startDay,
  stopDay,
  toggleTodo,
  workspaceDir,
} from "../src/lib/state.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "workspace-context-"));
  const env = { WORKSPACE_CONTEXT_STATE_DIR: root };
  const workspace = {
    id: "w1",
    label: "API",
    cwd: "/projects/api",
  };
  return { root, env, workspace };
}

test("persists tracking, notes, todos, agents, and shared context", () => {
  const { env, workspace } = fixture();
  startDay(workspace, env, new Date("2026-07-23T08:00:00.000Z"));
  addNote(workspace, "review", "Reviewed authentication changes", env);
  const added = addTodo(workspace, "Ship authentication fix", env);
  const todo = added.state.todos[0];
  toggleTodo(workspace, todo.id, env);
  recordAgentStatus(
    workspace,
    {
      paneId: "w1:p2",
      agent: "codex",
      name: "review",
      status: "working",
      title: "Reviewing authentication",
    },
    env,
  );
  stopDay(workspace, env, new Date("2026-07-23T10:30:00.000Z"));

  const state = loadState(workspace, env);
  assert.equal(state.tracking.active, false);
  assert.equal(state.todos[0].done, true);
  assert.equal(state.agents["w1:p2"].status, "working");

  const events = readEvents(workspace.id, env);
  assert.ok(events.every((event) => !Number.isNaN(new Date(event.at).getTime())));
  assert.deepEqual(
    events.map((event) => event.type),
    [
      "workday_started",
      "note",
      "todo_added",
      "todo_completed",
      "agent_status",
      "workday_stopped",
    ],
  );

  const context = readFileSync(
    join(workspaceDir(workspace.id, env), "context.md"),
    "utf8",
  );
  assert.match(context, /Ship authentication fix/);
  assert.match(context, /Reviewed authentication changes/);
  assert.match(context, /review: working/);
});

test("deduplicates identical agent status observations", () => {
  const { env, workspace } = fixture();
  const status = {
    paneId: "w1:p2",
    agent: "claude",
    name: "review",
    status: "idle",
    title: null,
  };
  recordAgentStatus(workspace, status, env);
  recordAgentStatus(workspace, status, env);
  assert.equal(
    readEvents(workspace.id, env).filter((event) => event.type === "agent_status")
      .length,
    1,
  );
});
