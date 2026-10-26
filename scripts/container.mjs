import { spawn } from "node:child_process";
const children = new Set();
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
    process.exit(code);
  }, 3000).unref();
}
process.on("SIGTERM", () => stop());
process.on("SIGINT", () => stop());
function start(args, options = {}) {
  const child = spawn(process.execPath, args, { stdio: "inherit", ...options });
  children.add(child);
  child.once("error", () => stop(1));
  child.once("exit", (code) => {
    children.delete(child);
    if (!stopping) stop(code || 1);
  });
  return child;
}
const env = {
  ...process.env,
  API_URL: "http://127.0.0.1:9000/",
  API_PORT: "9000",
  API_LISTEN_ADDRESS: "127.0.0.1",
  DURATION_LIMIT: "18000",
  RATELIMIT_MAX: "120",
  FORCE_LOCAL_PROCESSING: "always",
  TUNNEL_LIFESPAN: "90",
};
for (const key of [
  "PORT",
  "COOKIE_PATH",
  "YOUTUBE_SESSION_SERVER",
  "CUSTOM_INNERTUBE_CLIENT",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "API_AUTH_REQUIRED",
  "API_KEY_URL",
  "TURNSTILE_SITEKEY",
  "TURNSTILE_SECRET",
  "API_INSTANCE_COUNT",
  "API_REDIS_URL",
])
  delete env[key];
start(["src/cobalt.js"], { cwd: "/app", env });
let ready = false;
for (let n = 0; n < 90 && !stopping; n++) {
  try {
    const r = await fetch("http://127.0.0.1:9000/", {
      signal: AbortSignal.timeout(1000),
    });
    if (r.ok && (await r.json()).cobalt) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
if (!ready) {
  console.error("내부 Cobalt 서버가 시작되지 않았습니다.");
  stop(1);
} else {
  // Bind the public health port without waiting for the generated sample.
  start(["server/index.mjs"]);
  const sample = spawn(process.execPath, ["scripts/sample.mjs"], {
    stdio: "inherit",
    env: { ...process.env, REUSE_SAMPLE: "1" },
  });
  children.add(sample);
  sample.on("error", () => console.error("샘플을 생성하지 못했습니다."));
  sample.on("exit", (code) => {
    children.delete(sample);
    if (code)
      console.error(
        "샘플 생성 실패: YouTube 연결은 별도로 사용할 수 있습니다.",
      );
  });
}
