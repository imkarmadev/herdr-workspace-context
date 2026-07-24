import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("shortcut action opens the dashboard against Herdr's active pane", () => {
  const directory = mkdtempSync(join(tmpdir(), "workspace-context-shortcut-"));
  const mockHerdr = join(directory, "herdr");
  const argsFile = join(directory, "args.txt");
  writeFileSync(
    mockHerdr,
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$MOCK_ARGS_FILE"\nprintf \'{"ok":true}\\n\'\n',
  );
  chmodSync(mockHerdr, 0o700);

  const result = spawnSync(
    process.execPath,
    ["src/action.mjs", "open-dashboard"],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: {
        ...process.env,
        HERDR_BIN_PATH: mockHerdr,
        MOCK_ARGS_FILE: argsFile,
        WORKSPACE_CONTEXT_STATE_DIR: directory,
        HERDR_PLUGIN_ID: "imkarmadev.workspace-context",
        HERDR_WORKSPACE_ID: "w7",
        HERDR_PANE_ID: "w7:p3",
        HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({
          workspace: {
            workspace_id: "w7",
            label: "API",
            cwd: "/projects/api",
          },
        }),
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(argsFile, "utf8").trim().split("\n"), [
    "plugin",
    "pane",
    "open",
    "--plugin",
    "imkarmadev.workspace-context",
    "--entrypoint",
    "dashboard",
    "--focus",
  ]);
});
