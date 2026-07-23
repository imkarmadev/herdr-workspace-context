import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildReport } from "../src/lib/report.mjs";
import {
  addNote,
  addTodo,
  recordAgentStatus,
  startDay,
  stopDay,
  toggleTodo,
} from "../src/lib/state.mjs";

test("daily report contains actual work evidence, not only tracking events", () => {
  const env = {
    WORKSPACE_CONTEXT_STATE_DIR: mkdtempSync(
      join(tmpdir(), "workspace-context-report-"),
    ),
  };
  const workspace = {
    id: "w1",
    label: "My workspace",
    cwd: "/projects/mogo",
  };

  startDay(workspace, env, new Date("2026-07-23T06:26:00.000Z"));
  addNote(workspace, "review", "Reviewed WhatsApp allowed-setting changes", env);
  addNote(workspace, "decision", "Keep validation in the API boundary", env);
  const task = addTodo(workspace, "Review SD-2921", env).state.todos[0];
  toggleTodo(workspace, task.id, env);
  recordAgentStatus(
    workspace,
    {
      paneId: "w1:p2",
      agent: "codex",
      name: "review",
      status: "working",
      title: "Reviewing SD-2921",
      at: "2026-07-23T07:00:00.000Z",
    },
    env,
  );
  recordAgentStatus(
    workspace,
    {
      paneId: "w1:p2",
      agent: "codex",
      name: "review",
      status: "done",
      title: "Reviewing SD-2921",
      at: "2026-07-23T07:20:00.000Z",
    },
    env,
  );
  stopDay(workspace, env, new Date("2026-07-23T08:26:00.000Z"));

  const report = buildReport({
    workspace,
    env,
    date: new Date("2026-07-23T12:00:00.000Z"),
    gitCollector: () => ({
      root: "/projects/mogo",
      branch: "bugfix/SD-2921",
      commits: [
        {
          shortHash: "abc1234",
          subject: "fix: validate allowed setting",
        },
      ],
      changes: [{ code: " M", path: "src/settings.ts" }],
    }),
  });

  assert.match(report.markdown, /### Reviews/);
  assert.match(report.markdown, /Reviewed WhatsApp allowed-setting changes/);
  assert.match(report.markdown, /### Decisions/);
  assert.match(report.markdown, /Review SD-2921/);
  assert.match(report.markdown, /abc1234/);
  assert.match(report.markdown, /1 active turn/);
  assert.match(report.markdown, /20m working/);
  assert.match(report.markdown, /Tracking: 2h 0m/);
});
