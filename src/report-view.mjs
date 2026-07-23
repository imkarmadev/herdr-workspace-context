import { stdin, stdout } from "node:process";
import { generateReport } from "./lib/report.mjs";
import { resolveWorkspace } from "./lib/runtime.mjs";

const workspace = resolveWorkspace(process.env);
const report = generateReport({ workspace });

if (!stdin.isTTY || !stdout.isTTY) {
  stdout.write(report.markdown);
} else {
  let offset = 0;
  const lines = report.markdown.split("\n");

  function render() {
    const height = Math.max(5, (stdout.rows || 30) - 2);
    const body = lines.slice(offset, offset + height);
    stdout.write(
      `\u001b[2J\u001b[H${body.join("\n")}\n\u001b[2m${report.file} · j/k or arrows scroll · q close\u001b[0m`,
    );
  }

  function close() {
    stdin.setRawMode(false);
    stdout.write("\u001b[?25h\u001b[?1049l");
    process.exit(0);
  }

  function keypress(buffer) {
    const key = buffer.toString();
    const page = Math.max(1, (stdout.rows || 30) - 4);
    if (key === "q" || key === "\u001b" || key === "\u0003") close();
    else if (key === "j" || key === "\u001b[B") offset += 1;
    else if (key === "k" || key === "\u001b[A") offset -= 1;
    else if (key === " " || key === "\u0006") offset += page;
    else if (key === "\u0002") offset -= page;
    offset = Math.max(0, Math.min(offset, Math.max(0, lines.length - page)));
    render();
  }

  stdout.write("\u001b[?1049h\u001b[?25l");
  stdin.setRawMode(true);
  stdin.resume();
  stdin.on("data", keypress);
  process.on("SIGTERM", close);
  process.on("SIGHUP", close);
  render();
}
