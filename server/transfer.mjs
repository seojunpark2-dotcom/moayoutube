import { open, rm } from "node:fs/promises";
import { LIMIT } from "./library.mjs";
import { DOWNLOAD_DEADLINE_MS, DOWNLOAD_IDLE_MS } from "./limits.mjs";

function failure(message, retryable = false) {
  return Object.assign(new Error(message), { retryable });
}
function aborted(signal) {
  if (signal?.aborted)
    throw signal.reason || failure("다운로드가 취소되었습니다.");
}
function untilAbort(promise, signal) {
  return new Promise((resolve, reject) => {
    const cancel = () =>
      reject(signal.reason || failure("다운로드가 취소되었습니다."));
    if (signal.aborted) {
      cancel();
      return;
    }
    signal.addEventListener("abort", cancel, { once: true });
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", cancel));
  });
}
function retryable(error) {
  return (
    error.retryable === true ||
    ["TypeError", "TimeoutError"].includes(error.name) ||
    [
      "ECONNRESET",
      "ETIMEDOUT",
      "UND_ERR_SOCKET",
      "UND_ERR_CONNECT_TIMEOUT",
    ].includes(error.cause?.code || error.code)
  );
}

// Transport is supplied separately: production callers always use the DNS-pinned HTTPS session.
// Positional writes let independent byte ranges share a file without buffering it in RAM.
export async function transferToFile({
  request,
  file,
  limit = LIMIT,
  onProgress,
  signal,
  chunkSize = 8 * 1024 * 1024,
  concurrency = 4,
  ranges = true,
  idleMs = DOWNLOAD_IDLE_MS,
  deadlineMs = DOWNLOAD_DEADLINE_MS,
  retries = 2,
}) {
  const controller = new AbortController();
  const deadline = setTimeout(
    () =>
      controller.abort(
        failure(
          "다운로드 제한 시간(60분)을 초과했습니다. 더 낮은 화질로 다시 시도해 주세요.",
        ),
      ),
    deadlineMs,
  );
  const relay = () => controller.abort(signal.reason);
  if (signal?.aborted) relay();
  else signal?.addEventListener("abort", relay, { once: true });
  let handle,
    workers = [],
    received = 0,
    total = 0,
    entityTag,
    ranged = false;
  const sessions = new Set();
  const report = () => onProgress?.(received, total);
  async function responseFor(start, end) {
    aborted(controller.signal);
    const local = new AbortController();
    const relayLocal = () => local.abort(controller.signal.reason);
    controller.signal.addEventListener("abort", relayLocal, { once: true });
    let timer;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () =>
          local.abort(
            failure(
              "서버에서 45초 동안 데이터를 받지 못했습니다. 연결을 다시 시도합니다.",
              true,
            ),
          ),
        idleMs,
      );
    };
    let session;
    const finish = () => {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", relayLocal);
      local.abort();
      sessions.delete(session);
    };
    reset();
    try {
      const response = await untilAbort(
        request({
          headers: {
            ...(ranges ? { Range: `bytes=${start}-${end}` } : {}),
            "Accept-Encoding": "identity",
            ...(entityTag ? { "If-Range": entityTag } : {}),
          },
          signal: local.signal,
        }),
        local.signal,
      );
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw failure(
          [401, 403].includes(response.status)
            ? "원본 파일 링크가 만료되었거나 접근이 제한되었습니다. 링크를 다시 확인해 주세요."
            : `원본 서버가 응답하지 않았습니다(HTTP ${response.status}).`,
          [408, 429, 500, 502, 503, 504].includes(response.status),
        );
      }
      if (
        !/^(video\/|audio\/|application\/octet-stream)/i.test(
          response.headers.get("content-type") || "",
        )
      ) {
        await response.body?.cancel().catch(() => {});
        throw failure("원본 서버가 영상·음원 파일을 반환하지 않았습니다.");
      }
      session = { response, signal: local.signal, reset, finish };
      sessions.add(session);
      return session;
    } catch (e) {
      finish();
      throw e;
    }
  }
  async function getResponse(start, end) {
    for (let n = 0; ; n++) {
      try {
        return await responseFor(start, end);
      } catch (e) {
        aborted(controller.signal);
        if (n >= retries || !retryable(e)) throw e;
        await untilAbort(
          new Promise((r) => setTimeout(r, Math.min(200 * (n + 1), 1000))),
          controller.signal,
        );
      }
    }
  }
  function rangeOf(response, start, end, expectedTotal) {
    const match = response.headers
      .get("content-range")
      ?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if (response.status !== 206 || !match)
      throw failure("원본 서버의 부분 다운로드 응답이 올바르지 않습니다.");
    const [a, b, size] = match.slice(1).map(Number);
    const tag = response.headers.get("etag");
    if (entityTag && tag && tag !== entityTag)
      throw failure(
        "다운로드 중 원본 파일이 변경되었습니다. 다시 시도해 주세요.",
      );
    if (!entityTag && tag && !tag.startsWith("W/")) entityTag = tag;
    if (!Number.isSafeInteger(size) || size <= 0 || size > limit)
      throw failure(
        "파일 크기 제한을 초과했습니다. 원본 합계와 결과는 각각 최대 2GB까지 지원합니다.",
      );
    if (
      a !== start ||
      b !== Math.min(end, size - 1) ||
      (expectedTotal && size !== expectedTotal)
    )
      throw failure(
        "원본 파일의 범위 또는 크기가 변경되었습니다. 링크를 다시 확인해 주세요.",
      );
    return { end: b, total: size };
  }
  async function write(bytes, position) {
    let offset = 0;
    while (offset < bytes.byteLength) {
      aborted(controller.signal);
      const result = await handle.write(
        bytes,
        offset,
        bytes.byteLength - offset,
        position + offset,
      );
      if (!result.bytesWritten)
        throw failure("임시 파일을 기록하지 못했습니다.");
      offset += result.bytesWritten;
    }
  }
  async function consume(session, start, end) {
    const reader = session.response.body.getReader();
    let cursor = start;
    try {
      while (true) {
        session.reset();
        const { done, value } = await untilAbort(reader.read(), session.signal);
        if (done) break;
        if (cursor + value.byteLength > end + 1)
          throw failure("원본 서버가 요청한 범위보다 큰 파일을 보냈습니다.");
        await write(value, cursor);
        cursor += value.byteLength;
        received += value.byteLength;
        report();
      }
      return cursor;
    } catch (e) {
      e.cursor = cursor;
      throw e;
    } finally {
      session.finish();
      await reader.cancel().catch(() => {});
    }
  }
  async function segment(start, end, initial) {
    let cursor = start;
    for (let attempt = 0; cursor <= end; attempt++) {
      let session;
      try {
        session = initial || (await getResponse(cursor, end));
        initial = null;
        rangeOf(session.response, cursor, end, total);
        cursor = await consume(session, cursor, end);
        session = null;
        if (cursor <= end)
          throw Object.assign(
            failure("원본 연결이 완료 전에 끊어졌습니다.", true),
            { cursor },
          );
      } catch (e) {
        session?.finish();
        await session?.response.body?.cancel().catch(() => {});
        cursor = e.cursor ?? cursor;
        aborted(controller.signal);
        if (attempt >= retries || !retryable(e)) throw e;
      }
    }
  }
  try {
    aborted(controller.signal);
    handle = await open(file, "w+");
    let first = await getResponse(0, chunkSize - 1);
    if (first.response.status === 206 && ranges) {
      ranged = true;
      let range;
      try {
        range = rangeOf(first.response, 0, chunkSize - 1);
      } catch (e) {
        first.finish();
        await first.response.body.cancel().catch(() => {});
        throw e;
      }
      total = range.total;
      report();
      await handle.truncate(total);
      let next = range.end + 1;
      // Start the first body alongside the pool instead of waiting for it in serial.
      // The first task also drains queued ranges, keeping the connection count bounded.
      const initial = first;
      first = null;
      workers = Array.from(
        {
          length: Math.min(concurrency, Math.ceil(total / chunkSize)),
        },
        async (_, index) => {
          if (index === 0) await segment(0, range.end, initial);
          while (next < total) {
            const start = next;
            next += chunkSize;
            await segment(start, Math.min(start + chunkSize - 1, total - 1));
          }
        },
      );
      await Promise.all(workers);
    } else if (first.response.status === 200) {
      // Servers that ignore Range keep a bounded, streaming single-connection fallback.
      for (let attempt = 0; ; attempt++) {
        const session = first || (await getResponse(0, chunkSize - 1));
        first = null;
        try {
          if (session.response.status !== 200)
            throw failure("원본 서버의 다운로드 방식이 변경되었습니다.");
          const length =
            Number(session.response.headers.get("content-length")) || 0;
          if (length > limit)
            throw failure(
              "파일 크기 제한을 초과했습니다. 원본 합계와 결과는 각각 최대 2GB까지 지원합니다.",
            );
          total = length;
          received = 0;
          await handle.truncate(0);
          report();
          const end = await consume(session, 0, limit - 1);
          if (total && end !== total)
            throw failure("원본 연결이 완료 전에 끊어졌습니다.", true);
          total = end;
          break;
        } catch (e) {
          session.finish();
          await session.response.body?.cancel().catch(() => {});
          aborted(controller.signal);
          if (attempt >= retries || !retryable(e)) throw e;
        }
      }
    } else {
      first.finish();
      await first.response.body?.cancel().catch(() => {});
      throw failure("지원하지 않는 원본 서버 응답입니다.");
    }
    if (!received) throw failure("원본 파일이 비어 있습니다.");
    report();
    return { size: received, total, ranged };
  } catch (e) {
    controller.abort(e);
    await Promise.allSettled(workers);
    throw e;
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener("abort", relay);
    for (const session of sessions) {
      session.finish();
      await session.response.body?.cancel().catch(() => {});
    }
    await handle?.close();
    if (controller.signal.aborted)
      await rm(file, { force: true }).catch(() => {});
  }
}
