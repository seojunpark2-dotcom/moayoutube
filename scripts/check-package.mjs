import { readFile, writeFile } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";
const { directory } = JSON.parse(
  await readFile(".data/dist/latest-package.json", "utf8"),
);
const url = "http://127.0.0.1:47831",
  origin = url;
try {
  await fetch(url + "/api/health", { signal: AbortSignal.timeout(500) });
  throw Error("먼저 실행 중인 로컬 프로그램을 종료하세요.");
} catch (e) {
  if (e.message.includes("먼저")) throw e;
}
const env = {
  ...process.env,
  PATH: path.join(process.env.SystemRoot || "C:\\Windows", "System32"),
};
for (const key of [
  "PYTHON_BIN",
  "PYTHONPATH",
  "NODE_PATH",
  "NODE_OPTIONS",
  "FFMPEG_PATH",
  "FFPROBE_PATH",
])
  delete env[key];
const python = execFileSync(
  path.join(directory, "runtime/python/python.exe"),
  ["-m", "yt_dlp", "--version"],
  { cwd: directory, env, encoding: "utf8", windowsHide: true },
).trim();
assert.equal(python, "2026.10.21");
const child = spawn(
  path.join(directory, "runtime/node.exe"),
  ["scripts/local-start.mjs", "--no-open"],
  { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
);
let logs = "",
  sessionHeaders;
child.stdout.on("data", (c) => (logs += c));
child.stderr.on("data", (c) => (logs += c));
try {
  let health;
  for (let i = 0; i < 100; i++) {
    try {
      health = await fetch(url + "/api/health").then((r) => r.json());
      if (health.mode === "local-companion") break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(health?.youtubeProvider, "yt-dlp", logs);
  assert.equal(health?.features?.progressiveAnalysis, true);
  const root = await fetch(url + "/");
  assert.equal(root.status, 200);
  assert.equal(root.headers.get("x-frame-options"), "DENY");
  assert.equal((await fetch(url + "/api/samples")).status, 401);
  const { token } = await fetch(url + "/api/local/session", {
    headers: { Origin: origin },
  }).then((r) => r.json());
  const headers = {
    Origin: origin,
    "X-Moadrop-Token": token,
    "Content-Type": "application/json",
  };
  sessionHeaders = headers;
  const post = (p, b) =>
    fetch(url + p, { method: "POST", headers, body: JSON.stringify(b) });
  const { token: job } = await (
    await post("/api/jobs", { id: "studio", format: "mp3", bitrate: 128 })
  ).json();
  let state;
  for (let i = 0; i < 100; i++) {
    state = await fetch(url + "/api/jobs/" + job, { headers }).then((r) =>
      r.json(),
    );
    if (state.state !== "processing") break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(state.state, "done", JSON.stringify(state));
  const { ticket } = await (await post(`/api/jobs/${job}/ticket`, {})).json();
  const file = await fetch(url + `/api/jobs/${job}/file?ticket=${ticket}`);
  assert.equal(file.status, 200);
  const bytes = await file.arrayBuffer();
  assert.ok(bytes.byteLength > 1000);
  const result = {
    packagedPython: python,
    health,
    staticUI: true,
    unauthorizedBlocked: true,
    realMP3Bytes: bytes.byteLength,
  };
  await writeFile(
    ".data/dist/package-check.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  if (sessionHeaders)
    await fetch(url + "/api/local/shutdown", {
      method: "POST",
      headers: sessionHeaders,
      body: "{}",
    }).catch(() => {});
  else child.kill();
  await new Promise((r) => child.once("exit", r));
}
