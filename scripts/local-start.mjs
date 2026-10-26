import { spawn, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
const url = "http://127.0.0.1:47831/";
function openBrowser() {
  if (process.argv.includes("--no-open")) return;
  if (process.platform === "win32")
    execFile(
      "rundll32.exe",
      ["url.dll,FileProtocolHandler", url],
      { windowsHide: true },
      () => {},
    );
  else
    execFile(
      process.platform === "darwin" ? "open" : "xdg-open",
      [url],
      () => {},
    );
}
try {
  const health = await fetch(url + "api/health", {
    signal: AbortSignal.timeout(1000),
  }).then((r) => r.json());
  if (health.mode === "local-companion") {
    openBrowser();
    console.log("이미 실행 중입니다: " + url);
    process.exit(0);
  }
} catch {}
const python = path.join(root, "runtime", "python", "python.exe");
const child = spawn(process.execPath, ["server/index.mjs"], {
  stdio: "inherit",
  windowsHide: true,
  env: {
    ...process.env,
    LOCAL_COMPANION: "1",
    YOUTUBE_PROVIDER: "yt-dlp",
    ...(existsSync(python) ? { PYTHON_BIN: python } : {}),
    ...(existsSync(path.join(root, "runtime", "ffmpeg.exe"))
      ? {
          FFMPEG_PATH: path.join(root, "runtime", "ffmpeg.exe"),
          FFPROBE_PATH: path.join(root, "runtime", "ffprobe.exe"),
        }
      : {}),
  },
});
let stopping = false;
function stop() {
  if (!stopping) {
    stopping = true;
    child.kill();
  }
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("error", (e) => {
  console.error(e.message);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code || 0));
for (let n = 0; n < 60; n++) {
  try {
    const r = await fetch(url + "api/health", {
      signal: AbortSignal.timeout(1000),
    });
    if (r.ok && (await r.json()).mode === "local-companion") {
      console.log("모아유튭 로컬 프로그램이 실행되었습니다: " + url);
      console.log("종료하려면 이 창에서 Ctrl+C를 누르세요.");
      openBrowser();
      break;
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
