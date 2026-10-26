import express from "express";
import metadata from "../package.json" with { type: "json" };
import { rateLimit } from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { mkdir, rm, stat, readdir } from "node:fs/promises";
import path from "node:path";
import { analyzeYoutube, youtubeCached, youtubeProvider } from "./youtube.mjs";
import { JOB_TIMEOUT_MS } from "./limits.mjs";
import { jobKey } from "./job-key.mjs";
import { MP3_BITRATES, VIDEO_QUALITIES } from "./output-options.mjs";
import {
  restoreResults,
  saveResult,
  pruneResults,
  RESULT_TTL_MS,
} from "./result-cache.mjs";
import { isAllowedWebOrigin } from "./web-origins.mjs";
import { localAccess, LOCAL_PORT } from "./local-access.mjs";
const localMode = process.env.LOCAL_COMPANION === "1";
const listenPort = localMode
  ? LOCAL_PORT
  : Number(process.env.PORT || process.env.API_PORT || 4000);
if (localMode) process.env.YOUTUBE_PROVIDER = "yt-dlp";
const access = localMode ? localAccess() : null;
import {
  hasStorage,
  freeDiskBytes,
  directoryBytes,
  JOB_RESERVATION_BYTES,
} from "./storage.mjs";
import {
  ROOT,
  LIMIT,
  SAMPLE,
  library,
  publicInfo,
  parseURL,
  youtubeID,
  inspect,
  probeFile,
} from "./library.mjs";
const testNamespace =
  process.env.NODE_ENV === "test" &&
  /^[a-f0-9-]{36}$/i.test(process.env.TEST_JOB_NAMESPACE || "")
    ? process.env.TEST_JOB_NAMESPACE
    : "";
const app = express(),
  jobs = new Map(),
  TEMP = path.join(
    ROOT,
    process.env.NODE_ENV === "test"
      ? "test-jobs" + (testNamespace ? "-" + testNamespace : "")
      : "jobs",
  );
await mkdir(TEMP, { recursive: true });
// Restore only validated completed results. Interrupted jobs are never resumed.
if (process.env.NODE_ENV === "test" && !testNamespace) {
  for (const entry of await readdir(TEMP))
    await rm(path.join(TEMP, entry), { recursive: true, force: true });
} else {
  for (const [token, job] of await restoreResults(TEMP)) jobs.set(token, job);
}
app.disable("x-powered-by");
if (localMode)
  app.use((req, res, next) => {
    res.set("X-Frame-Options", "DENY");
    res.set("Content-Security-Policy", "frame-ancestors 'none'");
    res.set("Referrer-Policy", "no-referrer");
    next();
  });
if (access) app.use("/api", access.middleware);
app.use(express.json({ limit: "4kb" }));
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  res.set("X-Content-Type-Options", "nosniff");
  if (
    req.method === "POST" &&
    !isAllowedWebOrigin(req.headers.origin) &&
    !(
      localMode &&
      [
        `http://127.0.0.1:${LOCAL_PORT}`,
        `http://localhost:${LOCAL_PORT}`,
      ].includes(req.headers.origin)
    )
  )
    return res.status(403).json({ error: "허용되지 않은 요청 출처입니다." });
  next();
});
app.use(
  "/api",
  rateLimit({
    windowMs: 60000,
    limit: 240,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "요청이 많습니다. 잠시 후 다시 시도해 주세요." },
  }),
);
const jobLimit = rateLimit({
  windowMs: 60000,
  limit: 8,
  legacyHeaders: false,
  message: { error: "변환 요청이 많습니다. 1분 후 다시 시도해 주세요." },
});
app.get("/api/health", (_, res) =>
  res.json({
    ok: true,
    mode: localMode ? "local-companion" : "server",
    protocol: 1,
    version: metadata.version,
    youtubeProvider: youtubeProvider(),
    active: [...jobs.values()].filter((j) => j.state === "processing").length,
  }),
);
app.post("/api/local/shutdown", (req, res) => {
  if (!localMode) return res.sendStatus(404);
  res.json({ ok: true });
  setTimeout(shutdown, 100);
});
app.get("/api/samples", async (_, res) =>
  res.json((await library()).map(publicInfo)),
);
app.get("/api/thumbnail/:id", async (req, res) => {
  if (!(await library()).some((x) => x.id === req.params.id))
    return res.sendStatus(404);
  res.sendFile(path.join(ROOT, "thumbs", req.params.id + ".jpg"), {
    dotfiles: "allow",
  });
});
app.post("/api/analyze", async (req, res) => {
  const { format = "mp4", quality = 720, bitrate = 128 } = req.body;
  if (
    !["mp3", "mp4", "m4a", "opus", "original"].includes(format) ||
    (format === "mp4" && !VIDEO_QUALITIES.includes(quality)) ||
    (format !== "mp4" && ![...MP3_BITRATES, 192].includes(bitrate))
  )
    return res
      .status(400)
      .json({ error: "요청한 파일 형식 또는 화질을 확인해 주세요." });
  const u = parseURL(
    typeof req.body.url === "string" ? req.body.url.trim() : req.body.url,
  );
  const item = (await library()).find((x) => x.url === u.href);
  if (item) return res.json(publicInfo(item));
  const id = youtubeID(u);
  if (id) {
    const key = jobKey({ id: "yt:" + id, format, quality, bitrate });
    const saved = [...jobs.values()].find(
      (j) =>
        j.key === key &&
        j.state === "done" &&
        Date.now() - j.completedAt < RESULT_TTL_MS,
    );
    if (
      saved &&
      (await stat(saved.output).then(
        (s) => s.isFile(),
        () => false,
      ))
    ) {
      return res.json({
        id: "yt:" + id,
        title: saved.title,
        author: saved.author || "저장된 결과",
        thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        duration: saved.duration,
        qualities: format === "mp4" ? [saved.height] : [],
        height: saved.height,
        downloadable: true,
        convertible: format !== "mp4",
        youtube: true,
        cached: true,
        nativeAudioFormat: null,
        source: "YouTube · 저장된 결과",
        permission: "검증된 완료 파일을 재사용합니다.",
      });
    }
    const cached = youtubeCached("yt:" + id, { format, quality });
    if (cached) return res.json(cached.info);
    const [streams, metadata] = await Promise.allSettled([
      analyzeYoutube(id, { format, quality }),
      (async () => {
        const r = await fetch(
          "https://www.youtube.com/oembed?format=json&url=" +
            encodeURIComponent("https://www.youtube.com/watch?v=" + id),
          { signal: AbortSignal.timeout(10000), redirect: "error" },
        );
        if (!r.ok) throw Error();
        return r.json();
      })(),
    ]);
    if (streams.status === "fulfilled") {
      const entry = streams.value;
      if (metadata.status === "fulfilled") {
        entry.info.title = metadata.value.title;
        entry.info.author = metadata.value.author_name;
        entry.title = entry.info.title;
      }
      return res.json(entry.info);
    }
    const downloadError = streams.reason.message;
    if (metadata.status !== "fulfilled") {
      return res.status(422).json({
        error: downloadError,
      });
    }
    const data = metadata.value;
    return res.json({
      id,
      title: data.title,
      author: data.author_name,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      duration: null,
      source: "YouTube · 공식 oEmbed",
      qualities: [],
      downloadable: false,
      convertible: false,
      permission: downloadError,
      downloadErrorCode: streams.reason.code || "YOUTUBE_UNSUPPORTED_FORMAT",
      youtube: true,
    });
  }
  return res.status(422).json({
    error:
      "다운로드 권한이 확인되지 않은 소스입니다. 승인된 샘플을 사용하거나 관리자가 권한 근거와 함께 소스를 등록해야 합니다.",
  });
});
app.post("/api/jobs", jobLimit, async (req, res) => {
  const { id, format, quality, bitrate } = req.body;
  const key = jobKey(req.body);
  function reusable() {
    return [...jobs.values()].find(
      (j) =>
        j.key === key &&
        ["processing", "done"].includes(j.state) &&
        (!j.completedAt || Date.now() - j.completedAt < RESULT_TTL_MS),
    );
  }
  let existing = reusable();
  if (existing?.state === "done") {
    if (
      await stat(existing.output).then(
        () => true,
        () => false,
      )
    )
      return res.json({ token: existing.token, cached: true });
    jobs.delete(existing.token);
  } else if (existing)
    return res.status(202).json({ token: existing.token, reused: true });
  let youtube =
    typeof id === "string" && /^yt:[\w-]{11}$/.test(id)
      ? youtubeCached(id, req.body)
      : null;
  if (!youtube && typeof id === "string" && /^yt:[\w-]{11}$/.test(id))
    youtube = await analyzeYoutube(id.slice(3), req.body);
  const item = youtube || (await library()).find((x) => x.id === id);
  if (typeof id === "string" && id.startsWith("yt:") && !youtube)
    return res.status(410).json({
      error: "YouTube 영상 정보가 만료되었습니다. 링크를 다시 확인해 주세요.",
    });
  if (!item)
    return res
      .status(403)
      .json({ error: "승인된 소스만 다운로드할 수 있습니다." });
  if (!["mp4", "mp3", "m4a", "opus", "original"].includes(format))
    return res.status(400).json({ error: "지원하지 않는 형식입니다." });
  if (format === "original" && !youtube?.info.nativeAudioFormat)
    return res
      .status(400)
      .json({ error: "이 소스의 원본 음원 형식을 지원하지 않습니다." });
  if (
    format === "mp4" &&
    !(youtube ? youtube.info.qualities : publicInfo(item).qualities).includes(
      quality,
    )
  )
    return res.status(400).json({ error: "원본에 맞는 화질을 선택해 주세요." });
  if (
    format !== "mp4" &&
    (!item.allowConvert ||
      !item.media.audio ||
      (format !== "original" && ![...MP3_BITRATES, 192].includes(bitrate)))
  )
    return res
      .status(400)
      .json({ error: "음원 변환 권한 또는 비트레이트를 확인해 주세요." });
  const freeBytes = await freeDiskBytes(TEMP);
  // Recheck after asynchronous reads so simultaneous requests reserve one job atomically.
  existing = reusable();
  if (existing)
    return res
      .status(existing.state === "done" ? 200 : 202)
      .json({ token: existing.token, reused: true });
  if ([...jobs.values()].filter((j) => j.state === "processing").length >= 2)
    return res.status(429).json({
      error: "다른 변환이 진행 중입니다. 잠시 후 다시 시도해 주세요.",
    });
  if (jobs.size >= 20)
    return res.status(429).json({
      error:
        "임시 저장 공간이 사용 중입니다. 완료 파일이 정리된 후 다시 시도해 주세요.",
    });
  if (!hasStorage(jobs.values(), freeBytes))
    return res.status(507).json({
      error:
        "임시 저장 공간이 부족합니다. 기존 파일이 자동 정리된 뒤 다시 시도하거나 더 낮은 화질을 선택해 주세요.",
    });
  const token = randomUUID(),
    dir = path.join(TEMP, token);
  mkdirSync(dir);
  const outputFormat =
    format === "original" ? youtube.info.nativeAudioFormat : format;
  const output = path.join(dir, "result." + outputFormat);
  const job = {
    token,
    key,
    state: "processing",
    progress: 0,
    created: Date.now(),
    output,
    dir,
    title: item.title,
    author: item.info?.author || item.author,
    format: outputFormat,
    phase: "preparing",
    child: null,
  };
  jobs.set(token, job);
  let sources;
  if (youtube && youtube.provider !== "cobalt") {
    if (format === "mp4") {
      const v = youtube.selection.videos.get(quality);
      sources = [v.url];
      if (!v.acodec || v.acodec === "none")
        sources.push(
          (youtube.selection.mp4Audio || youtube.selection.audio).url,
        );
    } else sources = [youtube.selection.audio.url];
  }
  const child = spawn(
    process.execPath,
    [
      "server/worker.mjs",
      JSON.stringify({
        input: youtube
          ? undefined
          : path.join(ROOT, "library", path.basename(item.file)),
        sources,
        cobalt:
          youtube?.provider === "cobalt"
            ? {
                id: id.slice(3),
                cached:
                  format === "mp4"
                    ? youtube.selection.videos.get(quality)
                    : {
                        ...youtube.selection.audio,
                        sources: youtube.selection.audio.sources,
                      },
              }
            : undefined,
        output,
        format: outputFormat,
        copyAudio: format === "original",
        quality,
        bitrate,
      }),
    ],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  job.child = child;
  let buffer = "";
  child.stderr.resume();
  const timer = setTimeout(() => {
    job.error =
      "전체 처리 제한 시간(120분)을 초과했습니다. 원본 형식이나 더 낮은 화질로 다시 시도해 주세요.";
    stopWorker(child);
  }, JOB_TIMEOUT_MS);
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      const m = line.match(/^out_time_us=(\d+)/);
      if (m)
        job.progress = Math.min(
          99,
          Math.round(
            (youtube ? 75 : 0) +
              (+m[1] /
                ((job.sourceDuration || item.media.duration || Infinity) *
                  1000000)) *
                (youtube ? 25 : 100),
          ),
        );
      if (line.startsWith("transfer=")) {
        try {
          const event = JSON.parse(line.slice(9));
          job.phase = event.phase;
          job.progress = Math.max(job.progress, event.progress || 0);
          for (const key of [
            "received",
            "total",
            "speed",
            "eta",
            "mode",
            "sourceDuration",
          ])
            if (key in event) job[key] = event[key];
        } catch {}
      }
      if (line.startsWith("worker_error=")) {
        try {
          job.error = JSON.parse(line.slice(13));
        } catch {}
      }
    }
  });
  let finished = false;
  async function finish(code) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    job.child = null;
    try {
      if (code !== 0) throw Error();
      const actual = await probeFile(output);
      const duration = +actual.format.duration;
      const size = (await stat(output)).size;
      if (!size || size >= LIMIT) throw Error();
      if (
        !Number.isFinite(duration) ||
        duration <= 0 ||
        !(job.sourceDuration || item.media.duration) ||
        Math.abs(duration - (job.sourceDuration || item.media.duration)) > 2
      )
        throw Error("변환 결과가 원본 길이와 일치하지 않습니다.");
      if (
        format === "mp4" &&
        !actual.streams.some(
          (s) => s.codec_type === "video" && s.height === quality,
        )
      )
        throw Error("영상 화질을 검증하지 못했습니다.");
      if (
        format !== "mp4" &&
        !actual.streams.some((s) => s.codec_type === "audio")
      )
        throw Error("음원 트랙을 확인하지 못했습니다.");
      if (sources || youtube?.provider === "cobalt")
        await Promise.all(
          [0, 1].map((i) =>
            rm(path.join(dir, `source-${i}.media`), { force: true }).catch(
              () => {},
            ),
          ),
        );
      job.state = "done";
      job.duration = duration;
      job.height =
        actual.streams.find((s) => s.codec_type === "video")?.height || null;
      job.progress = 100;
    } catch {
      job.state = "error";
      job.error ||=
        "변환에 실패했습니다. 파일 형식이나 크기 제한을 확인해 주세요.";
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    job.diskBytes = await directoryBytes(dir).catch(
      () => JOB_RESERVATION_BYTES,
    );
    job.completedAt = Date.now();
    if (job.state === "done") {
      await saveResult(job).catch(() => {
        /* Result remains downloadable in this process. */
      });
      await pruneResults(jobs).catch(() => {});
    }
  }
  child.once("error", () => finish(1));
  child.once("close", (code) => finish(code));
  res.status(202).json({ token });
});
app.get("/api/jobs/:token", (req, res) => {
  const j = jobs.get(req.params.token);
  if (!j)
    return res
      .status(404)
      .json({ error: "작업이 없거나 만료되었습니다. 다시 요청해 주세요." });
  res.json({
    state: j.state,
    progress: j.progress,
    error: j.error,
    phase: j.phase,
    received: j.received,
    total: j.total,
    speed: j.speed,
    eta: j.eta,
    mode: j.mode,
  });
});
app.post("/api/jobs/:token/ticket", (req, res) => {
  const job = jobs.get(req.params.token);
  if (!access || !job || job.state !== "done") return res.sendStatus(404);
  res.json({ ticket: access.issue(job.token) });
});
app.get("/api/jobs/:token/file", (req, res) => {
  const j = jobs.get(req.params.token);
  if (!j || j.state !== "done")
    return res
      .status(404)
      .json({ error: "완료된 파일이 없거나 만료되었습니다." });
  const name =
    j.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 100) +
    "." +
    j.format;
  res.download(j.output, name, { dotfiles: "allow" });
});
const cleanup = setInterval(async () => {
  await pruneResults(jobs).catch(() => {});
}, 60000);
cleanup.unref();
if (localMode)
  app.use(
    express.static(
      path.resolve(existsSync("out/index.html") ? "out" : ".next-local"),
      {
        dotfiles: "deny",
        index: "index.html",
      },
    ),
  );
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  res.status(err.status || 400).json({
    error:
      err.type === "entity.too.large"
        ? "요청 크기가 너무 큽니다."
        : err.message || "요청을 처리하지 못했습니다.",
  });
});
if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535)
  throw Error("PORT 또는 API_PORT에 1~65535 범위의 포트를 지정하세요.");
app.listen(
  listenPort,
  localMode ? "127.0.0.1" : process.env.API_HOST || "127.0.0.1",
  () => console.log("변환 API 포트: " + listenPort),
);
function stopWorker(child) {
  if (process.platform === "win32" && child.pid)
    execFile(
      "taskkill",
      ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true },
      () => {},
    );
  else child.kill();
}
function shutdown() {
  for (const j of jobs.values()) if (j.child) stopWorker(j.child);
  setTimeout(() => process.exit(), 300).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
