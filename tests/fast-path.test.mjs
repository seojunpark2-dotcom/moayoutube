import test from "node:test";
import assert from "node:assert/strict";
import { jobKey } from "../server/job-key.mjs";
import { encodingOptions } from "../server/encoding.mjs";
test("작업 캐시 키는 실제 출력 옵션을 구분하고 무관한 옵션은 무시", () => {
  assert.equal(
    jobKey({ id: "x", format: "mp4", quality: 720, bitrate: 128 }),
    jobKey({ id: "x", format: "mp4", quality: 720, bitrate: 320 }),
  );
  assert.notEqual(
    jobKey({ id: "x", format: "mp4", quality: 720 }),
    jobKey({ id: "x", format: "mp4", quality: 360 }),
  );
  assert.notEqual(
    jobKey({ id: "x", format: "mp3", bitrate: 128 }),
    jobKey({ id: "x", format: "mp3", bitrate: 320 }),
  );
  assert.equal(
    jobKey({ id: "x", format: "original", bitrate: 128 }),
    jobKey({ id: "x", format: "original", bitrate: 320 }),
  );
  assert.notEqual(
    jobKey({ id: "x", format: "original" }),
    jobKey({ id: "y", format: "original" }),
  );
});
test("원본 음원은 비트레이트 변경과 재인코딩 없이 코덱 복사", () => {
  for (const format of ["m4a", "opus"]) {
    const options = encodingOptions({ format, copyAudio: true, bitrate: 320 });
    assert.equal(options[options.indexOf("-c:a") + 1], "copy");
    assert.ok(!options.includes("-b:a"));
  }
  assert.ok(
    encodingOptions({ format: "mp3", bitrate: 320 }).includes("libmp3lame"),
  );
});
