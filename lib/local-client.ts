const PORT = 47831;
let session = "";
export function localOrigin() {
  if (
    typeof window !== "undefined" &&
    ["127.0.0.1", "localhost"].includes(window.location.hostname) &&
    window.location.port === String(PORT)
  )
    return window.location.origin;
  return `http://127.0.0.1:${PORT}`;
}
export async function connectLocal() {
  try {
    const health = await fetch(localOrigin() + "/api/health", {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    }).then((r) => r.json());
    if (health.mode !== "local-companion" || health.protocol !== 1)
      throw Error();
    const r = await fetch(localOrigin() + "/api/local/session", {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!r.ok) throw Error();
    const data = await r.json();
    if (typeof data.token !== "string" || !/^[a-f0-9]{64}$/.test(data.token))
      throw Error();
    session = data.token;
    return health;
  } catch {
    session = "";
    throw Error(
      "로컬 프로그램을 실행한 뒤 연결해 주세요. 브라우저가 로컬 네트워크 접근을 물으면 허용해 주세요.",
    );
  }
}
export async function localFetch(route: string, body?: unknown) {
  if (!session) throw Error("로컬 프로그램에 먼저 연결해 주세요.");
  const r = await fetch(localOrigin() + route, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "X-Moadrop-Token": session,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(90000),
    cache: "no-store",
  }).catch(() => {
    session = "";
    throw Error(
      "로컬 프로그램 연결이 끊어졌습니다. 실행 상태를 확인하고 다시 연결해 주세요.",
    );
  });
  if (r.status === 401) session = "";
  return r;
}
export async function localAPI(route: string, body?: unknown) {
  const r = await localFetch(route, body);
  let data;
  try {
    data = await r.json();
  } catch {
    throw Error("로컬 프로그램 응답을 읽지 못했습니다.");
  }
  if (!r.ok) throw Error(data.error || "요청에 실패했습니다.");
  return data;
}
export async function localDownload(token: string) {
  const { ticket } = await localAPI(`/api/jobs/${token}/ticket`, {});
  return (
    localOrigin() +
    `/api/jobs/${token}/file?ticket=${encodeURIComponent(ticket)}`
  );
}
