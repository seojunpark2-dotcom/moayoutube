import test from "node:test";
import assert from "node:assert/strict";
import { createAnalysisTasks } from "../server/analysis-tasks.mjs";
test("공식 제목을 먼저 준비하면서 중복 화질 조회를 하나로 합침", async () => {
  let finish,
    calls = 0;
  const queue = createAnalysisTasks({
    extract: () => {
      calls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    metadata: async () => ({ title: "제목", author_name: "제작자" }),
  });
  const first = queue.get("video", { format: "mp4" });
  const second = queue.get("video", { format: "mp3" });
  assert.equal(first, second);
  await first.metadataPromise;
  assert.equal(first.state, "pending");
  assert.equal(first.metadata.title, "제목");
  assert.equal(calls, 1);
  finish({ info: { qualities: [720] } });
  await first.promise;
  assert.equal(first.state, "ready");
  assert.deepEqual(first.result.info.qualities, [720]);
});
test("조회 실패 시 같은 요청의 재시도 폭주를 막고 잠시 후 재시도 허용", async () => {
  let time = 0,
    calls = 0;
  const queue = createAnalysisTasks({
    now: () => time,
    extract: async () => {
      calls++;
      throw Error("원본 제한");
    },
    metadata: async () => {
      throw Error("메타데이터 실패");
    },
  });
  const first = queue.get("video", {});
  await Promise.all([first.promise, first.metadataPromise]);
  assert.equal(first.state, "error");
  assert.equal(first.metadata, null);
  assert.equal(queue.get("video", {}), first);
  assert.equal(calls, 1);
  time = 15001;
  const next = queue.get("video", {});
  assert.notEqual(next, first);
  await next.promise;
  assert.equal(calls, 2);
});
