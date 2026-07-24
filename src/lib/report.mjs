import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collectGitActivity } from "./git.mjs";
import { loadState, readEvents, workspaceDir } from "./state.mjs";

const categoryHeadings = {
  completed: "Completed",
  review: "Reviews",
  decision: "Decisions",
  in_progress: "In progress",
  blocker: "Blockers",
  note: "Notes",
};

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayBounds(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function reportTitleDate(date) {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function time(value) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function duration(milliseconds) {
  if (milliseconds <= 0) return "0m";
  const minutes = Math.round(milliseconds / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h ${rest}m` : `${rest}m`;
}

function trackingSummary(state, bounds, now) {
  const sessions = state.tracking.sessions.filter((session) => {
    const start = new Date(session.startedAt);
    const stop = new Date(session.stoppedAt ?? now);
    return stop >= bounds.start && start < bounds.end;
  });
  const milliseconds = sessions.reduce((sum, session) => {
    const start = Math.max(new Date(session.startedAt).getTime(), bounds.start.getTime());
    const stop = Math.min(
      new Date(session.stoppedAt ?? now).getTime(),
      bounds.end.getTime(),
    );
    return sum + Math.max(0, stop - start);
  }, 0);
  return { sessions, milliseconds };
}

function agentSummary(events, end) {
  const agents = new Map();
  for (const event of events.filter((item) => item.type === "agent_status")) {
    const key = event.paneId ?? event.name;
    const summary = agents.get(key) ?? {
      name: event.name ?? event.agent ?? key,
      status: "unknown",
      workingSince: null,
      workingMs: 0,
      turns: 0,
      blocked: 0,
    };
    const at = new Date(event.at).getTime();
    if (summary.workingSince && event.status !== "working") {
      summary.workingMs += Math.max(0, at - summary.workingSince);
      summary.workingSince = null;
    }
    if (event.status === "working" && summary.status !== "working") {
      summary.workingSince = at;
      summary.turns += 1;
    }
    if (event.status === "blocked" && summary.status !== "blocked") {
      summary.blocked += 1;
    }
    summary.status = event.status;
    if (event.title) summary.title = event.title;
    agents.set(key, summary);
  }
  for (const summary of agents.values()) {
    if (summary.workingSince) {
      summary.workingMs += Math.max(0, end.getTime() - summary.workingSince);
    }
  }
  return [...agents.values()];
}

function timelineLabel(event) {
  switch (event.type) {
    case "workday_started":
      return "Workday tracking started";
    case "workday_stopped":
      return "Workday tracking stopped";
    case "todo_added":
      return `Task added: ${event.text}`;
    case "todo_completed":
      return `Task completed: ${event.text}`;
    case "todo_reopened":
      return `Task reopened: ${event.text}`;
    case "workspace_event":
      return event.message;
    default:
      return null;
  }
}

export function buildReport({
  workspace,
  env = process.env,
  date = new Date(),
  gitCollector = collectGitActivity,
}) {
  const state = loadState(workspace, env);
  const bounds = dayBounds(date);
  const effectiveEnd = date < bounds.end ? date : bounds.end;
  const events = readEvents(workspace.id, env).filter((event) => {
    const at = new Date(event.at);
    return !Number.isNaN(at.getTime()) && at >= bounds.start && at < bounds.end;
  });
  const tracking = trackingSummary(state, bounds, effectiveEnd);
  const since =
    tracking.sessions.length > 0
      ? new Date(tracking.sessions[0].startedAt)
      : bounds.start;
  const git = gitCollector(workspace.cwd, since, effectiveEnd);
  const agents = agentSummary(events, effectiveEnd);
  const notes = events.filter((event) => event.type === "note");
  const completedTasks = events.filter((event) => event.type === "todo_completed");
  const lines = [
    `# Daily Report — ${reportTitleDate(date)}`,
    "",
    `## ${state.workspace.label ?? workspace.label ?? workspace.id}`,
    "",
    `- Tracking: ${tracking.sessions.length ? duration(tracking.milliseconds) : "not started"}`,
    state.workspace.cwd ? `- Directory: \`${state.workspace.cwd}\`` : null,
    git?.branch ? `- Branch: \`${git.branch}\`` : null,
    "",
  ].filter((line) => line !== null);

  for (const [category, heading] of Object.entries(categoryHeadings)) {
    const entries = notes.filter((note) => note.category === category);
    if (category === "completed") {
      entries.push(
        ...completedTasks.map((task) => ({
          text: task.text,
        })),
      );
    }
    if (!entries.length) continue;
    lines.push(`### ${heading}`, "", ...entries.map((entry) => `- ${entry.text}`), "");
  }

  if (git) {
    lines.push("### Git activity", "");
    if (git.commits.length) {
      lines.push(
        ...git.commits.map(
          (commit) => `- \`${commit.shortHash}\` ${commit.subject}`,
        ),
      );
    } else {
      lines.push("- No commits by the configured Git author during this work window.");
    }
    if (git.changes.length) {
      lines.push(
        `- Working tree: ${git.changes.length} changed file${
          git.changes.length === 1 ? "" : "s"
        } still in progress.`,
      );
    }
    lines.push("");
  }

  if (agents.length) {
    lines.push(
      "### Agent activity",
      "",
      ...agents.map(
        (agent) =>
          `- ${agent.name}: ${agent.turns} active turn${
            agent.turns === 1 ? "" : "s"
          }, ${duration(agent.workingMs)} working, last status **${agent.status}**${
            agent.blocked ? `, requested attention ${agent.blocked}×` : ""
          }.`,
      ),
      "",
    );
  }

  const timeline = events
    .map((event) => ({ at: event.at, label: timelineLabel(event) }))
    .filter((event) => event.label);
  if (timeline.length) {
    lines.push(
      "### Timeline",
      "",
      ...timeline.map((event) => `- ${time(event.at)} — ${event.label}`),
      "",
    );
  }

  if (!notes.length && !completedTasks.length && !git?.commits.length && !agents.length) {
    lines.push(
      "### Activity",
      "",
      "- No meaningful work evidence was captured. Add notes from the Workspace Context dashboard or verify Herdr agent integrations.",
      "",
    );
  }

  return {
    markdown: `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`,
    state,
    events,
    git,
  };
}

export function generateReport(options) {
  const result = buildReport(options);
  const reports = join(workspaceDir(options.workspace.id, options.env), "reports");
  mkdirSync(reports, { recursive: true });
  const key = localDateKey(options.date ?? new Date());
  const file = join(reports, `${key}.md`);
  const latest = join(reports, "latest.md");
  writeFileSync(file, result.markdown, { encoding: "utf8", mode: 0o600 });
  writeFileSync(latest, result.markdown, { encoding: "utf8", mode: 0o600 });
  return { ...result, file };
}
