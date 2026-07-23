import { spawnSync } from "node:child_process";

export function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function pluginContext(env = process.env) {
  return parseJson(env.HERDR_PLUGIN_CONTEXT_JSON, {}) ?? {};
}

export function pluginEvent(env = process.env) {
  const payload = parseJson(env.HERDR_PLUGIN_EVENT_JSON, {}) ?? {};
  return {
    name: env.HERDR_PLUGIN_EVENT ?? payload.event ?? payload.data?.type ?? "unknown",
    data: payload.data ?? payload,
    raw: payload,
  };
}

export function runHerdr(args, env = process.env) {
  const binary = env.HERDR_BIN_PATH || "herdr";
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    json: parseJson(result.stdout),
  };
}

function visit(value, predicate, output, seen) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (predicate(value)) output.push(value);
  if (Array.isArray(value)) {
    for (const item of value) visit(item, predicate, output, seen);
    return;
  }
  for (const item of Object.values(value)) {
    visit(item, predicate, output, seen);
  }
}

export function findObjects(value, predicate) {
  const output = [];
  visit(value, predicate, output, new Set());
  return output;
}

export function workspaceCandidate(value) {
  return findObjects(
    value,
    (item) =>
      typeof item.workspace_id === "string" &&
      ("label" in item || "cwd" in item || "active_tab_id" in item),
  )[0];
}

export function normalizeWorkspace(value, fallbackId) {
  if (!value && !fallbackId) return null;
  return {
    id: value?.workspace_id ?? value?.id ?? fallbackId,
    label: value?.label ?? null,
    cwd: value?.cwd ?? value?.checkout_path ?? null,
  };
}

export function resolveWorkspace(env = process.env, eventData = null) {
  const context = pluginContext(env);
  const id =
    env.HERDR_WORKSPACE_ID ??
    eventData?.workspace_id ??
    eventData?.workspace?.workspace_id ??
    eventData?.pane?.workspace_id ??
    context?.workspace_id ??
    context?.workspace?.workspace_id ??
    context?.workspace?.id;

  const direct =
    workspaceCandidate(eventData) ??
    workspaceCandidate(context) ??
    normalizeWorkspace(eventData?.workspace, id);
  let workspace = normalizeWorkspace(direct, id);

  if (id && (!workspace?.cwd || !workspace?.label)) {
    const response = runHerdr(["workspace", "get", id], env);
    const live = workspaceCandidate(response.json);
    if (live) {
      workspace = {
        id,
        label: live.label ?? workspace?.label ?? null,
        cwd: live.cwd ?? workspace?.cwd ?? null,
      };
    }
  }

  if (!workspace?.id) {
    throw new Error("Workspace Context requires a Herdr workspace invocation.");
  }
  return workspace;
}

export function liveAgents(workspaceId, env = process.env) {
  const response = runHerdr(["agent", "list"], env);
  if (!response.ok || !response.json) return [];
  const byPane = new Map();
  for (const item of findObjects(
    response.json,
    (value) =>
      typeof value.pane_id === "string" &&
      typeof value.agent_status === "string",
  )) {
    if (workspaceId && item.workspace_id !== workspaceId) continue;
    byPane.set(item.pane_id, {
      paneId: item.pane_id,
      name: item.name ?? item.display_agent ?? item.agent ?? item.pane_id,
      kind: item.display_agent ?? item.agent ?? "agent",
      status: item.agent_status,
      title: item.title ?? item.terminal_title_stripped ?? null,
      cwd: item.foreground_cwd ?? item.cwd ?? null,
    });
  }
  return [...byPane.values()];
}

export function notify(title, body, sound = "none", env = process.env) {
  const args = ["notification", "show", title];
  if (body) args.push("--body", body);
  if (sound) args.push("--sound", sound);
  return runHerdr(args, env);
}
