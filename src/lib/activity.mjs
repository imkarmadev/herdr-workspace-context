import { recordAgentStatus, recordEvent, refreshContext } from "./state.mjs";
import { pluginEvent, resolveWorkspace } from "./runtime.mjs";

function normalizedEventName(name) {
  return name.replaceAll("_", ".");
}

export function captureHerdrEvent(env = process.env) {
  const event = pluginEvent(env);
  const name = normalizedEventName(event.name);
  const data = event.data ?? {};
  const workspace = resolveWorkspace(env, data);

  if (name === "pane.agent.status.changed") {
    return recordAgentStatus(
      workspace,
      {
        paneId: data.pane_id,
        agent: data.agent ?? null,
        name: data.display_agent ?? data.agent ?? data.pane_id,
        status: data.agent_status,
        title: data.title ?? null,
      },
      env,
    );
  }

  if (name === "pane.agent.detected") {
    if (data.released || !data.agent) {
      return recordAgentStatus(
        workspace,
        {
          paneId: data.pane_id,
          agent: data.agent ?? null,
          name: data.agent ?? data.pane_id,
          status: data.final_status ?? "unknown",
          title: null,
        },
        env,
      );
    }
    return recordAgentStatus(
      workspace,
      {
        paneId: data.pane_id,
        agent: data.agent,
        name: data.agent,
        status: data.final_status ?? "unknown",
        title: null,
      },
      env,
    );
  }

  const workspaceMessages = {
    "workspace.created": `Workspace created${workspace.label ? `: ${workspace.label}` : ""}`,
    "workspace.renamed": `Workspace renamed${data.label ? ` to ${data.label}` : ""}`,
    "workspace.closed": "Workspace closed",
    "worktree.created": `Worktree created${
      data.worktree?.branch ? `: ${data.worktree.branch}` : ""
    }`,
    "worktree.opened": `Worktree opened${
      data.worktree?.branch ? `: ${data.worktree.branch}` : ""
    }`,
    "worktree.removed": `Worktree removed${
      data.worktree?.branch ? `: ${data.worktree.branch}` : ""
    }`,
  };
  if (workspaceMessages[name]) {
    return recordEvent(
      workspace,
      {
        type: "workspace_event",
        source: name,
        message: workspaceMessages[name],
      },
      env,
    );
  }

  if (name === "pane.exited" || name === "pane.closed") {
    return recordEvent(
      workspace,
      {
        type: "pane_event",
        source: name,
        paneId: data.pane_id,
      },
      env,
    );
  }

  return refreshContext(workspace, env);
}
