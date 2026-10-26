import { safeSession } from "./safe-fetch.mjs";

// The bundled service is loopback-only. A remote instance must use public HTTPS.
export function cobaltOrigin(value = process.env.COBALT_URL) {
  if (!value) throw Error("COBALT_URL에 Cobalt 서버 주소를 설정해 주세요.");
  const u = new URL(value);
  const local = u.origin === "http://127.0.0.1:9000";
  if (
    (!local && u.protocol !== "https:") ||
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.search ||
    u.hash
  )
    throw Error(
      "Cobalt 주소는 공개 HTTPS 원점 또는 번들 서버 주소여야 합니다.",
    );
  return u.origin;
}

export function cobaltError(code = "") {
  const message = /youtube.login/.test(code)
    ? "YouTube가 Cobalt 서버에도 봇 확인을 요구해 다운로드를 거절했습니다."
    : /auth/.test(code)
      ? "Cobalt 서버 인증 설정을 확인해 주세요."
      : /too_long/.test(code)
        ? "Cobalt 서버의 영상 길이 제한을 초과했습니다."
        : /private|age|region|drm|live/.test(code)
          ? "비공개·연령·지역·DRM 제한 영상 또는 실시간 방송은 처리하지 않습니다."
          : /rate/.test(code)
            ? "Cobalt 요청이 많습니다. 잠시 후 다시 시도해 주세요."
            : "Cobalt가 다운로드 가능한 원본을 제공하지 못했습니다.";
  return Object.assign(Error(message), {
    code: /youtube.login/.test(code)
      ? "YOUTUBE_BOT_CHECK"
      : "COBALT_UNAVAILABLE",
  });
}

export function cobaltTunnelURL(value, origin = cobaltOrigin()) {
  const u = new URL(value);
  if (
    u.origin !== origin ||
    u.pathname !== "/tunnel" ||
    u.username ||
    u.password ||
    u.hash
  )
    throw Error("Cobalt가 허용되지 않은 파일 주소를 반환했습니다.");
  return u.href;
}

export async function cobaltSession(value, origin = cobaltOrigin()) {
  const url = cobaltTunnelURL(value, origin);
  // Only this exact operator-controlled endpoint can access loopback.
  if (origin === "http://127.0.0.1:9000")
    return {
      request: (options) => fetch(url, { ...options, redirect: "error" }),
      close: async () => {},
    };
  return safeSession(url, { connections: 1 });
}

export function parseCobalt(data, id, origin = cobaltOrigin()) {
  if (data?.status === "error")
    throw cobaltError(String(data.error?.code || ""));
  if (
    data?.status !== "local-processing" ||
    data.service !== "youtube" ||
    data.isHLS ||
    !["merge", "audio"].includes(data.type) ||
    !Array.isArray(data.tunnel) ||
    (data.type === "merge"
      ? data.tunnel.length !== 2
      : ![1, 2].includes(data.tunnel.length))
  )
    throw Error(
      "Cobalt 응답 형식을 지원하지 않습니다. 일반 영상 원본 처리만 지원합니다.",
    );
  const filename = data.output?.filename;
  if (typeof filename !== "string" || !filename.startsWith(`youtube_${id}_`))
    throw Error("Cobalt 영상 정보가 요청한 영상과 일치하지 않습니다.");
  const resolution = filename.match(/_(\d{2,5})x(\d{2,5})_/);
  const width = resolution ? +resolution[1] : null;
  const height = resolution ? +resolution[2] : null;
  if (
    data.type === "merge" &&
    (!height || !width || width * height > 3840 * 2160)
  )
    throw Error("Cobalt 원본 영상의 해상도를 확인하지 못했습니다.");
  return {
    sources: data.tunnel
      .map((u) => cobaltTunnelURL(u, origin))
      .slice(0, data.type === "merge" ? 2 : 1),
    expires: Date.now() + 60_000,
    height,
    width,
    title: String(data.output?.metadata?.title || "YouTube 영상").slice(0, 300),
    author: String(data.output?.metadata?.artist || "YouTube").slice(0, 200),
  };
}

export async function requestCobalt(
  id,
  {
    quality = 720,
    audio = false,
    request,
    signal,
    origin = cobaltOrigin(),
  } = {},
) {
  if (!/^[\w-]{11}$/.test(id))
    throw Error("올바른 YouTube 영상 ID가 아닙니다.");
  let session;
  try {
    if (!request) {
      if (origin === "http://127.0.0.1:9000")
        request = (options) =>
          fetch(origin + "/", { ...options, redirect: "error" });
      else {
        session = await safeSession(origin + "/", { connections: 1 });
        request = session.request;
      }
    }
    const r = await request({
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(process.env.COBALT_API_KEY
          ? { Authorization: `Api-Key ${process.env.COBALT_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${id}`,
        videoQuality: String(quality),
        downloadMode: audio ? "audio" : "auto",
        audioFormat: "best",
        filenameStyle: "classic",
        youtubeVideoCodec: "h264",
        youtubeVideoContainer: "mp4",
        localProcessing: "forced",
        youtubeHLS: false,
      }),
      signal: AbortSignal.any([
        AbortSignal.timeout(45000),
        ...(signal ? [signal] : []),
      ]),
    });
    let body = "",
      size = 0;
    const decoder = new TextDecoder();
    for await (const chunk of r.body) {
      size += chunk.byteLength;
      if (size > 128 * 1024) throw Error("Cobalt 응답이 너무 큽니다.");
      body += decoder.decode(chunk, { stream: true });
    }
    body += decoder.decode();
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      throw Error("Cobalt 서버가 올바른 JSON 응답을 반환하지 않았습니다.");
    }
    if (!r.ok && data.status !== "error")
      throw cobaltError(r.status === 429 ? "fetch.rate" : "");
    return parseCobalt(data, id, origin);
  } catch (e) {
    if (e.name === "TimeoutError" || e.name === "TypeError")
      throw Object.assign(
        Error(
          "Cobalt 서버 연결이 지연되거나 실패했습니다. 서버 상태를 확인해 주세요.",
        ),
        { code: "COBALT_CONNECTION" },
      );
    throw e;
  } finally {
    await session?.close();
  }
}

export async function analyzeCobalt(id, options = {}, request = requestCobalt) {
  const { format = "mp4", quality = 720 } = options;
  const audio = format !== "mp4";
  const videos = new Map();
  const signal = AbortSignal.timeout(35000);
  const first = await request(id, { quality, audio, signal });
  if (!audio && first.height > 0 && first.height <= 1080)
    videos.set(first.height, first);
  if (!audio && !videos.size)
    throw Error("Cobalt에서 지원하는 영상 화질을 찾지 못했습니다.");
  return {
    provider: "cobalt",
    title: first.title,
    allowConvert: true,
    media: { duration: null, audio: true },
    selection: {
      videos,
      audio: { ...first, sources: first.sources.slice(audio ? 0 : 1) },
    },
    info: {
      id: "yt:" + id,
      title: first.title,
      author: first.author,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      duration: null,
      qualities: [...videos.keys()].sort((a, b) => b - a),
      downloadable: true,
      convertible: true,
      youtube: true,
      nativeAudioFormat: null,
      source: "YouTube · Cobalt",
      permission:
        "다운로드·변환 시 저작권과 해당 서비스 이용 조건을 준수해 주세요.",
    },
  };
}
