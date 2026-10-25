import test from "node:test";
import assert from "node:assert/strict";
import { youtubeFailure } from "../server/youtube-errors.mjs";
test("YouTube 봇 확인·인증·지역·요청 제한·실행 환경 실패를 구분", () => {
  for (const [stderr, code] of [
    ["ERROR: Sign in to confirm you’re not a bot", "YOUTUBE_BOT_CHECK"],
    ["ERROR: Sign in to confirm you're not a bot", "YOUTUBE_BOT_CHECK"],
    [
      "ERROR: Private video. Sign in if granted access",
      "YOUTUBE_AUTH_REQUIRED",
    ],
    ["ERROR: Video not available in your country", "YOUTUBE_REGION_BLOCKED"],
    ["ERROR: HTTP Error 429: Too Many Requests", "YOUTUBE_RATE_LIMIT"],
    ["ERROR: HTTP Error 403: Forbidden", "YOUTUBE_ACCESS_DENIED"],
    ["No module named yt_dlp", "YOUTUBE_RUNTIME_MISSING"],
    ["ERROR: n challenge solving failed", "YOUTUBE_EXTRACTOR_ERROR"],
  ])
    assert.equal(youtubeFailure({ stderr }).code, code, stderr);
});
test("외부 stderr·비밀 URL·실행 인수를 사용자 오류에 포함하지 않음", () => {
  const error = youtubeFailure({
    stderr: "ERROR: secret=https://example.com/signed?token=private",
  });
  assert.equal(error.code, "YOUTUBE_EXTRACTION_FAILED");
  assert.ok(!error.message.includes("token="));
  const policy = Error("실시간 방송은 지원하지 않습니다.");
  assert.equal(youtubeFailure(policy), policy);
  assert.equal(
    youtubeFailure({ signal: "SIGKILL" }).code,
    "YOUTUBE_PROCESS_KILLED",
  );
  assert.equal(
    youtubeFailure({ signal: "SIGKILL", stderr: "WARNING: interrupted" }).code,
    "YOUTUBE_PROCESS_KILLED",
  );
  assert.equal(youtubeFailure({ killed: true }).code, "YOUTUBE_TIMEOUT");
});
