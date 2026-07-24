import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { captureHerdrEvent } from "../src/lib/activity.mjs";
import { resolveWorkspace } from "../src/lib/runtime.mjs";
import { loadState, readEvents } from "../src/lib/state.mjs";

test("captures a Herdr agent status transition from hook environment", () => {
  const root = mkdtempSync(join(tmpdir(), "workspace-context-event-"));
  const env = {
    WORKSPACE_CONTEXT_STATE_DIR: root,
    HERDR_WORKSPACE_ID: "w1",
    HERDR_PLUGIN_EVENT: "pane.agent_status_changed",
    HERDR_PLUGIN_EVENT_JSON: JSON.stringify({
      event: "pane_agent_status_changed",
      data: {
        type: "pane_agent_status_changed",
        workspace_id: "w1",
        pane_id: "w1:p2",
        agent: "codex",
        display_agent: "Codex",
        agent_status: "blocked",
        title: "Needs approval",
      },
    }),
    HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({
      workspace: {
        workspace_id: "w1",
        label: "API",
        cwd: "/projects/api",
      },
    }),
    HERDR_BIN_PATH: "/missing/herdr",
  };

  captureHerdrEvent(env);

  const state = loadState({ id: "w1" }, env);
  assert.equal(state.agents["w1:p2"].status, "blocked");
  assert.equal(readEvents("w1", env)[0].type, "agent_status");
});

test("resolves Herdr's flat plugin invocation workspace context", () => {
  const workspace = resolveWorkspace({
    HERDR_WORKSPACE_ID: "w4",
    HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({
      workspace_id: "w4",
      workspace_label: "mogo",
      workspace_cwd: "/Users/imkarma/Projects/mogo",
    }),
    HERDR_BIN_PATH: "/missing/herdr",
  });

  assert.deepEqual(workspace, {
    id: "w4",
    label: "mogo",
    cwd: "/Users/imkarma/Projects/mogo",
  });
});

test("prefers a real workspace pane cwd over a focused plugin cwd", () => {
  const directory = mkdtempSync(join(tmpdir(), "workspace-context-runtime-"));
  const mockHerdr = join(directory, "herdr");
  writeFileSync(
    mockHerdr,
    `#!/bin/sh
printf '%s\n' '{"id":"test","result":{"panes":[{"workspace_id":"w4","pane_id":"w4:p6","focused":true,"label":"Workspace Context","cwd":"/Users/imkarma/Projects/herdr-workspace-context","foreground_cwd":"/Users/imkarma/Projects/herdr-workspace-context"},{"workspace_id":"w4","pane_id":"w4:p1","focused":false,"agent":"codex","cwd":"/Users/imkarma/Projects/mogo","foreground_cwd":"/Users/imkarma/Projects/mogo"}]}}'
`,
  );
  chmodSync(mockHerdr, 0o700);

  const workspace = resolveWorkspace({
    HERDR_WORKSPACE_ID: "w4",
    HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({
      workspace_id: "w4",
      workspace_label: "mogo",
      workspace_cwd: "/Users/imkarma/Projects/herdr-workspace-context",
      focused_pane_cwd: "/Users/imkarma/Projects/herdr-workspace-context",
    }),
    HERDR_BIN_PATH: mockHerdr,
    HERDR_PANE_ID: "w4:p6",
    HERDR_PLUGIN_ROOT: "/Users/imkarma/Projects/herdr-workspace-context",
  });

  assert.equal(workspace.cwd, "/Users/imkarma/Projects/mogo");
});
