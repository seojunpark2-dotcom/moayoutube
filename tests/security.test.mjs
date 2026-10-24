import test from "node:test";
import assert from "node:assert/strict";
import { parseURL, youtubeID, qualities } from "../server/library.mjs";
import { publicAddress, safeSession } from "../server/safe-fetch.mjs";

test("실제 등록 경로에서도 루프백 다운로드를 거절", async () => {
  await assert.rejects(safeSession("https://127.0.0.1/private.mp4"), /내부/);
});
test("URL 인증·포트·프로토콜 검증", () => {
  for (const u of [
    "file:///etc/passwd",
    "http://example.com/a.mp4",
    "https://a:b@example.com/a",
    "https://example.com:8443/a",
    "bad",
  ])
    assert.throws(() => parseURL(u));
});
test("SSRF: 내부 주소와 IPv4-mapped IPv6 차단", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "0.0.0.0",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "100.64.0.1",
    "224.0.0.1",
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress("8.8.8.8"), true);
});
test("YouTube 호스트와 영상 ID를 엄격하게 파싱", () => {
  assert.equal(
    youtubeID(
      new URL(
        "https://www.youtube.com/watch?v=yr5_rejdivA&list=RDyr5_rejdivA&start_radio=1",
      ),
    ),
    "yr5_rejdivA",
  );
  assert.equal(
    youtubeID(new URL("https://youtu.be/dQw4w9WgXcQ")),
    "dQw4w9WgXcQ",
  );
  assert.equal(
    youtubeID(new URL("https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ")),
    null,
  );
  assert.equal(
    youtubeID(new URL("https://youtube.com/watch?v=../../foo")),
    null,
  );
});
test("원본보다 높은 화질은 만들지 않음", () => {
  assert.deepEqual(qualities(720), [720, 480, 360]);
  assert.deepEqual(qualities(180), [180]);
});
