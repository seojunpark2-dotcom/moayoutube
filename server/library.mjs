import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import probe from "ffprobe-static";
import { MAX_FILE_BYTES } from "./limits.mjs";
export const ROOT = path.resolve(".data");
export const LIMIT = MAX_FILE_BYTES;
export const SAMPLE = "https://sample.moadrop.local/studio-loop.mp4";
export async function library() {
  try {
    return JSON.parse(await readFile(path.join(ROOT, "library.json"), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}
export async function saveLibrary(items) {
  await mkdir(ROOT, { recursive: true });
  await writeFile(
    path.join(ROOT, "library.json"),
    JSON.stringify(items, null, 2),
  );
}
export async function probeFile(file) {
  const { stdout } = await promisify(execFile)(
    probe.path,
    [
      "-max_alloc",
      "67108864",
      "-protocol_whitelist",
      "file,pipe",
      "-v",
      "error",
      "-show_format",
      "-show_streams",
      "-of",
      "json",
      file,
    ],
    { timeout: 15000, maxBuffer: 1024 * 1024 },
  );
  return JSON.parse(stdout);
}
export async function inspect(file) {
  const p = await probeFile(file);
  const video = p.streams.find((s) => s.codec_type === "video");
  const audio = p.streams.find((s) => s.codec_type === "audio");
  if (
    !video ||
    video.width * video.height > 3840 * 2160 ||
    p.streams.length > 16 ||
    !Number.isFinite(+p.format.duration) ||
    +p.format.duration <= 0 ||
    +p.format.size > LIMIT
  )
    throw Error(
      "길이를 확인할 수 있는 2GB 이하의 영상 파일만 처리할 수 있습니다(최대 4K·16개 트랙).",
    );
  return {
    duration: +p.format.duration,
    height: video.height,
    width: video.width,
    audio: !!audio,
    audioBitrate: audio?.bit_rate ? Math.round(+audio.bit_rate / 1000) : null,
    size: +p.format.size,
  };
}
export function qualities(height) {
  return [
    ...new Set([360, 480, 720, 1080, height].filter((h) => h <= height)),
  ].sort((a, b) => b - a);
}
export function publicInfo(item) {
  return {
    id: item.id,
    url: item.url,
    title: item.title,
    author: item.author,
    thumbnail: "/api/thumbnail/" + item.id,
    ...item.media,
    qualities: qualities(item.media.height),
    downloadable: true,
    convertible: item.allowConvert && item.media.audio,
    permission: item.permissionEvidence,
    source: "승인된 소스",
  };
}
export function parseURL(value) {
  if (typeof value !== "string" || value.length > 2048)
    throw Error("올바른 영상 URL을 입력해 주세요.");
  let u;
  try {
    u = new URL(value);
  } catch {
    throw Error("https://로 시작하는 올바른 URL을 입력해 주세요.");
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port)
    throw Error("인증 정보와 별도 포트가 없는 HTTPS URL만 지원합니다.");
  return u;
}
export function youtubeID(u) {
  if (u.hostname === "youtu.be")
    return /^\/[\w-]{11}$/.test(u.pathname) ? u.pathname.slice(1) : null;
  if (
    ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(u.hostname)
  ) {
    const id =
      u.pathname === "/watch"
        ? u.searchParams.get("v")
        : u.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})$/)?.[1];
    return /^[\w-]{11}$/.test(id || "") ? id : null;
  }
  return null;
}
