import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { parseURL, LIMIT } from "./library.mjs";
import { youtubeFailure } from "./youtube-errors.mjs";
const cache = new Map();
let extracting = 0;
export function youtubeMediaURL(value) {
  const u = parseURL(value);
  if (
    !u.hostname.endsWith(".googlevideo.com") ||
    u.hostname === "googlevideo.com"
  )
    throw Error("YouTube 미디어 서버가 아닌 주소는 처리할 수 없습니다.");
  return u.href;
}
export function selectYoutube(data) {
  if (
    data.is_live ||
    data.live_status === "is_live" ||
    data.live_status === "is_upcoming"
  )
    throw Error("실시간 방송과 공개 예정 영상은 지원하지 않습니다.");
  if (
    data.age_limit > 0 ||
    (data.availability && !["public", "unlisted"].includes(data.availability))
  )
    throw Error("로그인 또는 접근 권한이 필요한 영상은 지원하지 않습니다.");
  if (!Number.isFinite(data.duration) || data.duration <= 0)
    throw Error(
      "영상의 길이를 확인할 수 없습니다. 공개된 일반 영상만 지원합니다.",
    );
  const formats = (data.formats || []).filter((f) => {
    try {
      youtubeMediaURL(f.url);
      return (
        !f.has_drm &&
        f.protocol === "https" &&
        ["mp4", "webm", "m4a"].includes(f.ext) &&
        (!f.filesize || f.filesize < LIMIT)
      );
    } catch {
      return false;
    }
  });
  const allAudio = formats
    .filter((f) => f.acodec && f.acodec !== "none" && f.vcodec === "none")
    .sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0));
  const stereo = allAudio.filter(
    (f) => !f.audio_channels || f.audio_channels <= 2,
  );
  const audioFormats = stereo.length ? stereo : allAudio;
  const audio = audioFormats[0],
    mp4Audio = audioFormats.find((f) => f.acodec.startsWith("mp4a"));
  const videos = new Map();
  for (const f of formats.filter(
    (f) =>
      f.vcodec &&
      f.vcodec !== "none" &&
      f.height > 0 &&
      f.height <= 1080 &&
      f.width * f.height <= 3840 * 2160,
  )) {
    if (f.acodec === "none" && !audio) continue;
    if (
      f.acodec === "none" &&
      f.filesize &&
      (mp4Audio || audio)?.filesize &&
      f.filesize + (mp4Audio || audio).filesize >= LIMIT
    )
      continue;
    const current = videos.get(f.height);
    const rank = (x) =>
      (x.vcodec?.startsWith("avc") ? 100000 : 0) + (x.tbr || 0);
    if (!current || rank(f) > rank(current)) videos.set(f.height, f);
  }
  const muxed = formats.find(
    (f) => f.acodec && f.acodec !== "none" && f.vcodec && f.vcodec !== "none",
  );
  if (!videos.size && !audio && !muxed)
    throw Error(
      "인증·DRM·접근 제한 우회 없이 받을 수 있는 직접 파일 형식이 없습니다.",
    );
  return { duration: data.duration, audio: audio || muxed, mp4Audio, videos };
}
export function youtubeCached(id) {
  const entry = cache.get(id);
  if (entry && entry.expires > Date.now()) return entry;
  if (entry) cache.delete(id);
  return null;
}
export async function analyzeYoutube(id) {
  if (!/^[\w-]{11}$/.test(id))
    throw Error("올바른 YouTube 영상 ID가 아닙니다.");
  const cached = youtubeCached("yt:" + id);
  if (cached) return cached;
  if (extracting >= 2)
    throw Error(
      "다른 YouTube 링크를 확인 중입니다. 잠시 후 다시 시도해 주세요.",
    );
  extracting++;
  try {
    const { stdout } = await promisify(execFile)(
      process.env.PYTHON_BIN || "python",
      [
        "-m",
        "yt_dlp",
        "--ignore-config",
        "--no-playlist",
        "--skip-download",
        "--dump-single-json",
        "--no-cache-dir",
        "--no-warnings",
        "--socket-timeout",
        "10",
        "--retries",
        "0",
        "--extractor-retries",
        "0",
        "--no-js-runtimes",
        "--js-runtimes",
        `node:${process.execPath}`,
        "--",
        `https://www.youtube.com/watch?v=${id}`,
      ],
      {
        env: {
          ...process.env,
          PYTHONPATH: path.resolve(".tools/python"),
          PYTHONNOUSERSITE: "1",
        },
        timeout: 45000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      },
    );
    const data = JSON.parse(stdout);
    if (data.id !== id || data.extractor_key !== "Youtube")
      throw Error("YouTube 영상 정보가 일치하지 않습니다.");
    const selection = selectYoutube(data);
    const info = {
      id: "yt:" + id,
      title: data.title || "YouTube 영상",
      author: data.channel || data.uploader || "YouTube",
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      duration: data.duration,
      qualities: [...selection.videos.keys()].sort((a, b) => b - a),
      height: Math.max(0, ...selection.videos.keys()),
      downloadable: selection.videos.size > 0 || !!selection.audio,
      convertible: !!selection.audio,
      audioBitrate:
        Math.round(selection.audio?.abr || selection.audio?.tbr || 0) || null,
      source: "YouTube · 공개 영상",
      permission:
        "별도의 권한 확인 없이 공개 스트림을 처리합니다. 다운로드·변환 시 저작권과 해당 서비스 이용 조건을 준수해 주세요.",
      youtube: true,
      nativeAudioFormat: selection.audio?.acodec?.startsWith("mp4a")
        ? "m4a"
        : selection.audio?.acodec === "opus"
          ? "opus"
          : null,
    };
    for (const [key, value] of cache)
      if (value.expires < Date.now()) cache.delete(key);
    if (cache.size >= 40) cache.delete(cache.keys().next().value);
    const entry = {
      info,
      selection,
      expires: Date.now() + 5 * 60000,
      title: info.title,
      media: { duration: data.duration, audio: !!selection.audio },
      allowConvert: !!selection.audio,
    };
    cache.set(info.id, entry);
    return entry;
  } catch (e) {
    throw youtubeFailure(e);
  } finally {
    extracting--;
  }
}
