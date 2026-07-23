import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { captureHerdrEvent } from "../src/lib/activity.mjs";
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
