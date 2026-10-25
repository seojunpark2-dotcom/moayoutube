import { spawn } from "node:child_process";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
import { safeSession } from "./safe-fetch.mjs";
import { transferToFile } from "./transfer.mjs";
import { youtubeMediaURL } from "./youtube.mjs";
import { probeFile, LIMIT } from "./library.mjs";
import { encodingOptions } from "./encoding.mjs";
import { CONVERT_TIMEOUT_MS } from "./limits.mjs";
import { requestCobalt, cobaltSession } from "./cobalt.mjs";
const cfg = JSON.parse(process.argv[2]);
function event(value) {
  process.stdout.write("transfer=" + JSON.stringify(value) + "\n");
}
try {
  if (cfg.cobalt) {
    const resolved =
      cfg.cobalt.cached?.expires > Date.now() + 5000
        ? cfg.cobalt.cached
        : await requestCobalt(cfg.cobalt.id, {
            quality: cfg.quality,
            audio: cfg.format !== "mp4",
          });
    if (cfg.format === "mp4" && resolved.height !== cfg.quality)
      throw Error(
        "선택한 화질의 원본이 변경되었습니다. 링크를 다시 확인해 주세요.",
      );
    cfg.sources = resolved.sources;
  }
  if (cfg.sources) {
    const controller = new AbortController(),
      states = cfg.sources.map(() => ({ received: 0, total: 0 }));
    const started = Date.now();
    let last = 0;
    const tasks = cfg.sources.map(async (url, index) => {
      let session;
      try {
        session = cfg.cobalt
          ? await cobaltSession(url)
          : await safeSession(youtubeMediaURL(url), { connections: 8 });
        const file = path.join(
          path.dirname(cfg.output),
          `source-${index}.media`,
        );
        await transferToFile({
          request: session.request,
          file,
          signal: controller.signal,
          concurrency: cfg.cobalt ? 1 : 8,
          retries: cfg.cobalt ? 0 : 2,
          onProgress: (received, total) => {
            states[index] = { received, total };
            if (
              states.reduce(
                (sum, s) => sum + Math.max(s.received, s.total),
                0,
              ) > LIMIT
            )
              throw Error(
                "원본 파일 합계가 2GB를 초과합니다. 더 낮은 화질을 선택하거나 음원만 저장해 주세요.",
              );
            if (Date.now() - last < 200) return;
            last = Date.now();
            const bytes = states.reduce((n, s) => n + s.received, 0),
              allKnown = states.every((s) => s.total > 0),
              size = allKnown ? states.reduce((n, s) => n + s.total, 0) : 0;
            const speed = Math.round(
              bytes / Math.max((Date.now() - started) / 1000, 0.001),
            );
            event({
              phase: "downloading",
              received: bytes,
              total: size,
              speed,
              eta: size && speed ? Math.ceil((size - bytes) / speed) : null,
              progress: size
                ? Math.min(74, Math.floor((bytes / size) * 75))
                : 0,
            });
          },
        });
        if (index === 0) cfg.input = file;
        else cfg.audioInput = file;
      } catch (e) {
        controller.abort(e);
        throw e;
      } finally {
        await session?.close();
      }
    });
    const results = await Promise.allSettled(tasks);
    const failed = results.find((r) => r.status === "rejected");
    if (failed) throw failed.reason;
  }
  const first = await probeFile(cfg.input),
    second = cfg.audioInput ? await probeFile(cfg.audioInput) : first;
  const video = first.streams.find((s) => s.codec_type === "video"),
    audio = second.streams.find((s) => s.codec_type === "audio");
  if (
    !Number.isFinite(+first.format.duration) ||
    +first.format.duration <= 0 ||
    first.streams.length > 16 ||
    second.streams.length > 16 ||
    (video && video.width * video.height > 3840 * 2160)
  )
    throw Error("원본 파일의 길이 또는 미디어 규격을 확인하지 못했습니다.");
  const options = encodingOptions(cfg, video, audio);
  event({
    phase: "converting",
    sourceDuration: +first.format.duration,
    progress: cfg.sources ? 75 : 0,
    mode: cfg.copyAudio
      ? "audio-copy"
      : options.includes("copy") && !options.includes("libx264")
        ? "remux"
        : "encode",
  });
  const args = [
    "-max_alloc",
    "67108864",
    "-filter_threads",
    "2",
    "-filter_complex_threads",
    "2",
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-protocol_whitelist",
    "file,pipe",
    "-i",
    cfg.input,
    ...(cfg.audioInput ? ["-i", cfg.audioInput] : []),
    "-map_metadata",
    "-1",
    "-threads",
    "2",
    ...options,
    "-fs",
    String(LIMIT),
    "-progress",
    "pipe:1",
    "-y",
    cfg.output,
  ];
  const child = spawn(process.env.FFMPEG_PATH || ffmpeg, args, {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, CONVERT_TIMEOUT_MS);
  process.on("SIGTERM", () => child.kill());
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  child.on("error", () => {
    clearTimeout(timer);
    process.stdout.write(
      "worker_error=" + JSON.stringify("FFmpeg 실행에 실패했습니다.") + "\n",
    );
    process.exit(1);
  });
  child.on("close", (code) => {
    clearTimeout(timer);
    if (timedOut)
      process.stdout.write(
        "worker_error=" +
          JSON.stringify(
            "파일 변환 제한 시간(60분)을 초과했습니다. 원본 형식이나 더 낮은 화질을 선택해 주세요.",
          ) +
          "\n",
      );
    process.exit(code === 0 ? 0 : 1);
  });
} catch (e) {
  const message = ["TimeoutError", "AbortError"].includes(e.name)
    ? "원본 서버 연결이 지연되고 있습니다. 잠시 후 다시 시도해 주세요."
    : e.message === "fetch failed"
      ? "원본 서버와 연결하지 못했습니다. 네트워크 연결을 확인하고 다시 시도해 주세요."
      : e.message;
  process.stdout.write(
    "worker_error=" +
      JSON.stringify(message || "파일을 처리하지 못했습니다.") +
      "\n",
  );
  process.exitCode = 1;
}
