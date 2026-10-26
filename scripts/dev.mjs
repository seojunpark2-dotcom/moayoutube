import { spawn, execFile } from "node:child_process";
const production = process.argv.includes("--production");
const children = [
  spawn(process.execPath, ["server/index.mjs"], {
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, LOCAL_COMPANION: "1", YOUTUBE_PROVIDER: "yt-dlp" },
  }),
  spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      production ? "start" : "dev",
      "--hostname",
      "127.0.0.1",
    ],
    {
      stdio: "inherit",
      windowsHide: true,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    },
  ),
];
function stop() {
  for (const c of children) {
    if (process.platform === "win32" && c.pid)
      execFile(
        "taskkill",
        ["/PID", String(c.pid), "/T", "/F"],
        { windowsHide: true },
        () => {},
      );
    else c.kill();
  }
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const c of children)
  c.on("exit", (code) => {
    stop();
    process.exit(code || 0);
  });
