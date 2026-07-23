# Herdr Workspace Context

Workspace-level activity, shared tasks, agent status, and evidence-based daily
reports for [Herdr](https://herdr.dev/).

This plugin deliberately does not read or persist full terminal scrollback.
Instead, it records structured Herdr lifecycle events, explicit notes and tasks,
and local Git evidence when a report is generated.

## Requirements

- Herdr 0.7.5 or newer
- Node.js 18 or newer
- macOS or Linux

For accurate agent activity, install the Herdr integrations you use:

```sh
herdr integration install claude
herdr integration install codex
```

## Local development install

```sh
git clone git@github.com:imkarmadev/herdr-workspace-context.git
cd herdr-workspace-context
npm test
herdr plugin link "$PWD"
```

List the available entrypoints:

```sh
herdr plugin action list --plugin imkarmadev.workspace-context
```

Open the dashboard over the current workspace:

```sh
herdr plugin pane open \
  --plugin imkarmadev.workspace-context \
  --entrypoint dashboard
```

Other panes:

```sh
herdr plugin pane open \
  --plugin imkarmadev.workspace-context \
  --entrypoint add-note

herdr plugin pane open \
  --plugin imkarmadev.workspace-context \
  --entrypoint daily-report
```

Actions:

```sh
herdr plugin action invoke imkarmadev.workspace-context.start-day
herdr plugin action invoke imkarmadev.workspace-context.stop-day
herdr plugin action invoke imkarmadev.workspace-context.generate-report
```

## Dashboard controls

| Key | Action |
| --- | --- |
| `s` | Start or stop workday tracking |
| `n` | Add a categorized report note |
| `t` | Add a shared task |
| `j` / `k`, arrows | Select a task |
| `x` | Complete or reopen the selected task |
| `r` | Generate today's report |
| `q` / `Esc` | Close |

## Recommended shortcuts

Add these custom commands to the Herdr configuration:

```toml
[[keys.command]]
key = "prefix+d"
type = "plugin_action"
command = "imkarmadev.workspace-context.open-dashboard"
description = "open Workspace Context dashboard"

[[keys.command]]
key = "prefix+shift+a"
type = "plugin_action"
command = "imkarmadev.workspace-context.open-note"
description = "add Workspace Context note"

[[keys.command]]
key = "prefix+shift+e"
type = "plugin_action"
command = "imkarmadev.workspace-context.open-report"
description = "open Workspace Context daily report"
```

With Herdr's default prefix, press `Ctrl+B`, release it, then press:

- `D` for the dashboard
- `Shift+A` for a note
- `Shift+E` for the daily report

## What is persisted

Herdr provides a private state directory for the plugin. Each workspace gets:

- `state.json` — tracking sessions, current agent statuses, and shared tasks
- `events.jsonl` — append-only structured activity
- `context.md` — current tasks and agent state
- `reports/YYYY-MM-DD.md` — generated reports

The plugin uses file mode `0600` for state and report files. Plugin state is
local and is not committed to the project repository.

## Current report evidence

- Explicit notes: completed work, reviews, decisions, work in progress, blockers
- Shared task completion
- Workday tracking duration
- Herdr agent state transitions and approximate active time
- Commits by the repository's configured Git author during the tracking window
- Current branch and dirty working-tree count

GitHub review activity is not collected automatically yet. Record a review from
the dashboard or the `add-note` pane so it appears in the report.

## Privacy boundary

Herdr plugins execute as the current user and are not sandboxed. This plugin
stores structured events only and never collects raw pane output. Review the
manifest and source before installation, as you should with every Herdr plugin.
