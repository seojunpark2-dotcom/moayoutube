import test from "node:test";
import assert from "node:assert/strict";
import { hasStorage, JOB_RESERVATION_BYTES } from "../server/storage.mjs";
import {
  MAX_FILE_BYTES,
  MAX_TEMP_BYTES,
  DOWNLOAD_DEADLINE_MS,
  CONVERT_TIMEOUT_MS,
  JOB_TIMEOUT_MS,
  POLL_TIMEOUT_MS,
} from "../server/limits.mjs";
test("긴 영상 작업용 파일·시간 예산의 모든 계층이 일치", () => {
  assert.equal(MAX_FILE_BYTES, 2 * 1024 ** 3);
  assert.ok(DOWNLOAD_DEADLINE_MS + CONVERT_TIMEOUT_MS <= JOB_TIMEOUT_MS);
  assert.ok(POLL_TIMEOUT_MS > JOB_TIMEOUT_MS);
});
test("임시 파일 예약량과 디스크 여유 공간을 함께 제한", () => {
  assert.equal(hasStorage([], 32 * 1024 ** 3), true);
  assert.equal(hasStorage([{ state: "processing" }], 32 * 1024 ** 3), true);
  assert.equal(
    hasStorage([{ state: "done", diskBytes: MAX_TEMP_BYTES }], 32 * 1024 ** 3),
    false,
  );
  assert.equal(hasStorage([], JOB_RESERVATION_BYTES), false);
  assert.equal(
    hasStorage([{ state: "done", diskBytes: 512 * 1024 ** 2 }], 32 * 1024 ** 3),
    true,
  );
});
