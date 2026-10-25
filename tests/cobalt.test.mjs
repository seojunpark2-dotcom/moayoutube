import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeCobalt,
  parseCobalt,
  cobaltOrigin,
  cobaltTunnelURL,
  requestCobalt,
} from "../server/cobalt.mjs";
const origin = "https://cobalt.example.com",
  id = "aqz-KE-bpKQ";
const reply = (height = 720) => ({
  status: "local-processing",
  type: "merge",
  service: "youtube",
  isHLS: false,
  tunnel: [origin + "/tunnel?id=video", origin + "/tunnel?id=audio"],
  output: {
    filename: `youtube_${id}_1280x${height}_h264.mp4`,
    metadata: { title: "테스트 영상", artist: "제작자" },
  },
});
test("Cobalt 주소와 터널은 고정 원점·경로만 허용", () => {
  assert.equal(cobaltOrigin("http://127.0.0.1:9000"), "http://127.0.0.1:9000");
  for (const u of [
    "http://localhost:9000",
    "http://169.254.169.254",
    "https://user:pass@cobalt.example.com",
    origin + "/api",
  ])
    assert.throws(() => cobaltOrigin(u));
  for (const u of [
    "http://127.0.0.1:9000/tunnel",
    origin + "/admin",
    "https://evil.example/tunnel",
    origin + "/tunnel#x",
  ])
    assert.throws(() => cobaltTunnelURL(u, origin));
  assert.equal(parseCobalt(reply(), id, origin).height, 720);
  assert.throws(() => parseCobalt(reply(), "abcdefghijk", origin));
  assert.throws(() => parseCobalt({ ...reply(), isHLS: true }, id, origin));
  assert.throws(() =>
    parseCobalt({ status: "redirect", url: "http://127.0.0.1" }, id, origin),
  );
});
test("Cobalt 인증·봇 확인 오류를 숨기지 않고 안전한 한국어 오류로 전달", async () => {
  await assert.rejects(
    requestCobalt(id, {
      origin,
      request: async () =>
        Response.json({
          status: "error",
          error: { code: "error.api.youtube.login" },
        }),
    }),
    (e) => e.code === "YOUTUBE_BOT_CHECK" && /봇 확인/.test(e.message),
  );
  await assert.rejects(
    requestCobalt(id, {
      origin,
      request: async () => new Response("x".repeat(131073)),
    }),
    /너무 큽니다/,
  );
});
test("실제 반환된 화질만 노출하고 요청한 가짜 화질은 추가하지 않음", async () => {
  const m = await analyzeCobalt(id, async (_id, { quality }) =>
    parseCobalt(reply(quality === 360 ? 360 : 720), id, origin),
  );
  assert.deepEqual(m.info.qualities, [720, 360]);
  assert.equal(m.info.nativeAudioFormat, null);
  await assert.rejects(
    analyzeCobalt(id, async () => {
      throw Error("접근 거절");
    }),
    /접근 거절/,
  );
});
test("Cobalt 요청은 공식 API의 원본 처리 모드이며 비밀은 응답에 포함하지 않음", async () => {
  await requestCobalt(id, {
    origin,
    request: async (options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.localProcessing, "forced");
      assert.equal(body.filenameStyle, "classic");
      assert.equal(body.youtubeHLS, false);
      assert.equal(body.url, `https://www.youtube.com/watch?v=${id}`);
      return Response.json(reply());
    },
  });
});
