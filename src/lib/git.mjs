import { spawnSync } from "node:child_process";

function git(cwd, args) {
  if (!cwd) return { ok: false, stdout: "", stderr: "No workspace directory" };
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

export function collectGitActivity(cwd, since, until) {
  const root = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (!root.ok) return null;

  const branch = git(cwd, ["branch", "--show-current"]).stdout || "detached HEAD";
  const email = git(cwd, ["config", "user.email"]).stdout;
  const logArgs = [
    "log",
    `--since=${since.toISOString()}`,
    `--until=${until.toISOString()}`,
    "--format=%H%x1f%h%x1f%aI%x1f%s",
    "HEAD",
  ];
  if (email) logArgs.splice(1, 0, `--author=${email}`);
  const log = git(cwd, logArgs);
  const commits = log.ok
    ? log.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [hash, shortHash, at, subject] = line.split("\x1f");
          return { hash, shortHash, at, subject };
        })
    : [];

  const status = git(cwd, ["status", "--porcelain=v1", "--untracked-files=normal"]);
  const changes = status.ok
    ? status.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => ({ code: line.slice(0, 2), path: line.slice(3) }))
    : [];

  const diff = git(cwd, ["diff", "--stat", "HEAD"]);
  return {
    root: root.stdout,
    branch,
    commits,
    changes,
    diffStat: diff.ok ? diff.stdout : "",
  };
}
