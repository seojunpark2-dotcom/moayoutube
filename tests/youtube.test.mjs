import test from "node:test";
import assert from "node:assert/strict";
import { selectYoutube, youtubeMediaURL } from "../server/youtube.mjs";
const video = {
  url: "https://rr1.googlevideo.com/videoplayback?test=1",
  protocol: "https",
  ext: "mp4",
  vcodec: "avc1",
  acodec: "none",
  height: 720,
  width: 1280,
};
const audio = {
  url: "https://rr2.googlevideo.com/videoplayback?test=2",
  protocol: "https",
  ext: "m4a",
  vcodec: "none",
  acodec: "mp4a",
  abr: 128,
};
test("YouTube 권한 확인 없이 공개 영상의 실제 스트림만 선택", () => {
  const s = selectYoutube({
    duration: 8,
    availability: "public",
    formats: [video, audio],
  });
  assert.deepEqual([...s.videos.keys()], [720]);
  assert.equal(s.audio, audio);
});
test("스테레오가 있으면 불필요한 대용량 6채널 음원 수신을 피함", () => {
  const surround = { ...audio, audio_channels: 6, abr: 384 },
    stereo = { ...audio, audio_channels: 2, abr: 128 };
  const selected = selectYoutube({
    duration: 8,
    formats: [video, surround, stereo],
  });
  assert.equal(selected.audio, stereo);
  assert.equal(selected.mp4Audio, stereo);
});
test("DRM·비공개·연령 제한·라이브 영상은 지원하지 않음", () => {
  for (const change of [
    { availability: "private" },
    { age_limit: 18 },
    { is_live: true },
    { duration: 0 },
    { formats: [{ ...video, has_drm: true }] },
  ])
    assert.throws(() =>
      selectYoutube({
        duration: 8,
        availability: "public",
        formats: [video, audio],
        ...change,
      }),
    );
});
test("30분·1시간·여러 시간 영상과 100MB 초과 형식을 허용", () => {
  for (const duration of [1801, 3600, 24 * 3600]) {
    const selected = selectYoutube({
      duration,
      availability: "public",
      formats: [{ ...video, filesize: 512 * 1024 ** 2 }, audio],
    });
    assert.equal(selected.duration, duration);
    assert.equal(selected.videos.get(720).filesize, 512 * 1024 ** 2);
  }
});
test("YouTube 미디어 URL에 내부 주소·위장 도메인·다른 외부 호스트 금지", () => {
  for (const u of [
    "https://127.0.0.1/file",
    "https://googlevideo.com.evil.test/file",
    "https://example.com/file",
    "http://rr1.googlevideo.com/file",
    "https://user:pass@rr1.googlevideo.com/file",
  ])
    assert.throws(() => youtubeMediaURL(u));
});
