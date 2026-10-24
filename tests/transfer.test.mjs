import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { ROOT } from "../server/library.mjs";
import { transferToFile } from "../server/transfer.mjs";
import { encodingOptions } from "../server/encoding.mjs";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function target(t) {
  await mkdir(ROOT, { recursive: true });
  const dir = await mkdtemp(path.join(ROOT, "transfer-test-"));
  t.after(async () => {
    assert.equal(path.dirname(dir), ROOT);
    await rm(dir, { recursive: true, force: true });
  });
  return path.join(dir, "result.bin");
}
const payload = Buffer.from(
  Array.from({ length: 128 * 1024 }, (_, i) => i % 251),
);
function response(
  data,
  start,
  end,
  { delay = 0, part = 4096, onEnd = () => {}, stall = false } = {},
) {
  let position = start,
    ended = false;
  const finish = () => {
    if (!ended) {
      ended = true;
      onEnd();
    }
  };
  return new Response(
    new ReadableStream({
      async pull(c) {
        if (stall && position > start) return new Promise(() => {});
        if (delay) await wait(delay);
        if (ended) return;
        if (position > end) {
          finish();
          c.close();
          return;
        }
        const to = Math.min(position + part, end + 1);
        c.enqueue(data.subarray(position, to));
        position = to;
      },
      cancel() {
        finish();
      },
    }),
    {
      status: 206,
      headers: {
        "content-type": "video/mp4",
        "content-range": `bytes ${start}-${end}/${data.length}`,
        "content-length": String(end - start + 1),
        etag: '"same-file"',
      },
    },
  );
}
function range(headers, size) {
  const m = headers.Range.match(/^bytes=(\d+)-(\d+)$/);
  return [+m[1], Math.min(+m[2], size - 1)];
}
test("4개 병렬 구간을 파일에 기록해 원본 바이트를 정확하게 복원", async (t) => {
  const file = await target(t);
  let active = 0,
    peak = 0,
    calls = 0;
  const request = async ({ headers }) => {
    calls++;
    active++;
    peak = Math.max(peak, active);
    const [a, b] = range(headers, payload.length);
    return response(payload, a, b, { delay: 3, onEnd: () => active-- });
  };
  const result = await transferToFile({
    request,
    file,
    chunkSize: 16384,
    concurrency: 4,
  });
  assert.deepEqual(await readFile(file), payload);
  assert.equal(result.size, payload.length);
  assert.equal(calls, 8);
  assert.ok(peak > 1 && peak <= 4);
  assert.equal(active, 0);
});
test("지속 수신은 전체 소요 시간이 유휴 제한보다 길어도 중단하지 않음", async (t) => {
  const data = payload.subarray(0, 512),
    file = await target(t),
    started = Date.now();
  await transferToFile({
    file,
    chunkSize: 1024,
    idleMs: 50,
    deadlineMs: 2000,
    request: async ({ headers }) => {
      const [a, b] = range(headers, data.length);
      return response(data, a, b, { delay: 10, part: 32 });
    },
  });
  assert.ok(Date.now() - started > 100);
  assert.deepEqual(await readFile(file), data);
});

test("첫 구간이 느려도 나머지 7개 연결은 즉시 수신하고 전체 바이트 일치", async (t) => {
  const file = await target(t);
  let firstDone = false,
    othersBeforeFirst = 0,
    active = 0,
    peak = 0;
  await transferToFile({
    file,
    concurrency: 8,
    chunkSize: 16384,
    request: async ({ headers }) => {
      const [a, b] = range(headers, payload.length);
      if (a && !firstDone) othersBeforeFirst++;
      active++;
      peak = Math.max(peak, active);
      return response(payload, a, b, {
        delay: a ? 1 : 20,
        onEnd: () => {
          active--;
          if (!a) firstDone = true;
        },
      });
    },
  });
  assert.equal(othersBeforeFirst, 7);
  assert.equal(peak, 8);
  assert.equal(active, 0);
  assert.deepEqual(await readFile(file), payload);
});
test("멈춘 연결은 받은 위치 다음 바이트부터 이어받기", async (t) => {
  const data = payload.subarray(0, 128),
    file = await target(t),
    ranges = [];
  await transferToFile({
    file,
    chunkSize: 256,
    idleMs: 30,
    deadlineMs: 2000,
    retries: 2,
    request: async ({ headers }) => {
      ranges.push(headers.Range);
      const [a, b] = range(headers, data.length);
      return response(data, a, b, { part: 32, stall: ranges.length === 1 });
    },
  });
  assert.deepEqual(ranges, ["bytes=0-255", "bytes=32-127"]);
  assert.deepEqual(await readFile(file), data);
});
test("Range 미지원 서버는 스트리밍 방식으로 저장", async (t) => {
  const file = await target(t);
  let calls = 0;
  await transferToFile({
    file,
    request: async () => {
      calls++;
      return new Response(payload, {
        status: 200,
        headers: {
          "content-type": "video/mp4",
          "content-length": String(payload.length),
        },
      });
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(await readFile(file), payload);
});
test("접근 거절은 재시도하지 않고 임시 파일 삭제", async (t) => {
  const file = await target(t);
  let calls = 0;
  await assert.rejects(
    transferToFile({
      file,
      request: async () => {
        calls++;
        return new Response("", { status: 403 });
      },
    }),
    /접근이 제한/,
  );
  assert.equal(calls, 1);
  await assert.rejects(stat(file), { code: "ENOENT" });
});
test("유휴 재시도 소진·크기 초과·잘못된 범위 응답은 실패 후 정리", async (t) => {
  for (const scenario of ["idle", "size", "range"]) {
    const file = await target(t);
    const data = payload.subarray(0, 128);
    await assert.rejects(
      transferToFile({
        file,
        idleMs: 20,
        retries: 1,
        limit: scenario === "size" ? 64 : 1024,
        request: async () =>
          scenario === "range"
            ? response(data, 1, 127)
            : response(data, 0, 127, { part: 32, stall: scenario === "idle" }),
      }),
    );
    await assert.rejects(stat(file), { code: "ENOENT" });
  }
});
test("계속 수신 중에도 전체 작업 상한은 유지", async (t) => {
  const file = await target(t),
    data = payload.subarray(0, 512);
  await assert.rejects(
    transferToFile({
      file,
      idleMs: 100,
      deadlineMs: 40,
      retries: 0,
      request: async () => response(data, 0, 511, { delay: 10, part: 32 }),
    }),
    /제한 시간/,
  );
  await assert.rejects(stat(file), { code: "ENOENT" });
});
test("호환 MP4는 코덱 복사, 화질 변경·비호환 영상은 인코딩", () => {
  const cfg = { format: "mp4", quality: 720, audioInput: "audio.m4a" };
  const fast = encodingOptions(
    cfg,
    { codec_name: "h264", height: 720 },
    { codec_name: "aac" },
  );
  assert.ok(!fast.includes("libx264"));
  assert.ok(fast.includes("copy"));
  assert.ok(!fast.includes("-vf"));
  assert.ok(
    encodingOptions(
      { ...cfg, quality: 360 },
      { codec_name: "h264", height: 720 },
      { codec_name: "aac" },
    ).includes("libx264"),
  );
  assert.ok(
    encodingOptions(
      cfg,
      { codec_name: "vp9", height: 720 },
      { codec_name: "opus" },
    ).includes("libx264"),
  );
  assert.ok(encodingOptions({ format: "mp3", bitrate: 320 }).includes("320k"));
});
