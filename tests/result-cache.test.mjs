import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  restoreResults,
  saveResult,
  pruneResults,
  RESULT_TTL_MS,
  RESULT_CACHE_BYTES,
} from "../server/result-cache.mjs";
import { analysisKey } from "../server/output-options.mjs";

test("변환 결과는 재시작 후 복원되며 만료·손상 파일과 경로 위장은 거절", async () => {
  const root = path.resolve(".data/cache-test-" + randomUUID());
  await mkdir(root, { recursive: true });
  try {
    const token = randomUUID(),
      dir = path.join(root, token),
      now = Date.now();
    await mkdir(dir);
    const output = path.join(dir, "result.mp3");
    await writeFile(output, Buffer.alloc(1024, 1));
    const job = {
      token,
      dir,
      output,
      key: JSON.stringify(["yt:abcdefghijk", "mp3", null, 128]),
      title: "테스트",
      format: "mp3",
      created: now,
      completedAt: now,
      duration: 8,
    };
    await saveResult(job);
    let restored = await restoreResults(root, now + 1000);
    assert.equal(restored.get(token).state, "done");
    assert.equal(restored.get(token).output, output);
    await writeFile(output, "truncated");
    assert.equal((await restoreResults(root, now + 2000)).size, 0);
    await mkdir(dir);
    await writeFile(output, "data");
    await saveResult({ ...job, completedAt: now - RESULT_TTL_MS });
    assert.equal((await restoreResults(root, now)).size, 0);
    await mkdir(dir);
    await writeFile(output, "data");
    await saveResult(job);
    const manifest = JSON.parse(
      await readFile(path.join(dir, "manifest.json"), "utf8"),
    );
    await writeFile(
      path.join(dir, "manifest.json"),
      JSON.stringify({ ...manifest, format: "../../outside" }),
    );
    assert.equal((await restoreResults(root, now)).size, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("캐시 예산을 넘으면 오래된 완료 결과부터 삭제하고 진행 작업은 보존", async () => {
  const root = path.resolve(".data/cache-prune-" + randomUUID());
  await mkdir(root, { recursive: true });
  try {
    const jobs = new Map();
    const now = Date.now();
    for (const [i, state] of ["done", "done", "processing"].entries()) {
      const token = randomUUID(),
        dir = path.join(root, token);
      await mkdir(dir);
      jobs.set(token, {
        token,
        dir,
        state,
        created: now - 2000 + i * 500,
        completedAt: now - 2000 + i * 500,
        diskBytes: RESULT_CACHE_BYTES,
      });
    }
    await pruneResults(jobs, now);
    assert.deepEqual(
      [...jobs.values()].map((j) => j.state),
      ["done", "processing"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("음원 요청과 영상 화질 캐시는 서로 혼동하지 않음", () => {
  assert.notEqual(
    analysisKey("yt:x", { format: "mp3" }),
    analysisKey("yt:x", { format: "mp4", quality: 720 }),
  );
  assert.notEqual(
    analysisKey("yt:x", { format: "mp4", quality: 480 }),
    analysisKey("yt:x", { format: "mp4", quality: 720 }),
  );
});
