import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, stat } from "node:fs/promises";
import { probeFile } from "../server/library.mjs";
import { POLL_TIMEOUT_MS } from "../server/limits.mjs";
const url = process.argv[2];
if (!url) throw Error("30분 초과 테스트 영상 URL이 필요합니다.");
await mkdir(".data/qa", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1000 },
    acceptDownloads: true,
  });
  let media;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let last = "",
    current = "";
  page.on("response", async (response) => {
    try {
      const u = new URL(response.url());
      if (u.pathname === "/api/analyze") media = await response.json();
      if (
        /^\/api\/jobs\/[^/]+$/.test(u.pathname) &&
        response.request().method() === "GET"
      ) {
        const d = await response.json();
        const key =
          current + ":" + d.phase + ":" + Math.floor((d.progress || 0) / 10);
        if (last !== key) {
          last = key;
          console.log(
            JSON.stringify({
              format: current,
              state: d.state,
              phase: d.phase,
              progress: d.progress,
              received: d.received,
              total: d.total,
              error: d.error,
            }),
          );
        }
      }
    } catch {}
  });
  await page.goto("http://localhost:3000");
  await page.getByLabel("영상 URL").fill(url);
  await page.getByRole("button", { name: "링크 확인", exact: true }).click();
  await page.locator(".media-text h2").waitFor({ timeout: 60000 });
  assert.ok(media.duration > 1800);
  assert.ok(media.downloadable);
  console.log(
    JSON.stringify({
      title: media.title,
      duration: media.duration,
      qualities: media.qualities,
    }),
  );
  const selectedQuality =
    Number(
      process.argv.find((x) => x.startsWith("--quality="))?.split("=")[1],
    ) || media.qualities[0];
  await page.getByLabel("영상 화질").selectOption(String(selectedQuality));
  for (const format of process.argv.includes("--mp4-only")
    ? ["mp4"]
    : ["mp4", "original", "mp3"]) {
    current = format;
    if (format !== "mp4") {
      await page.getByRole("tab", { name: "음원 다운로드" }).click();
      await page.getByLabel("파일 형식").selectOption(format);
    }
    const pending = page.waitForEvent("download", { timeout: POLL_TIMEOUT_MS });
    const failed = page
      .locator('.error[role="alert"]')
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT_MS })
      .then(async () => {
        throw Error(await page.locator('.error[role="alert"]').innerText());
      });
    const started = Date.now();
    const result = Promise.race([pending, failed]);
    await page.getByRole("button", { name: "다운로드", exact: true }).click();
    const download = await result;
    assert.equal(await download.failure(), null);
    const elapsed = Date.now() - started;
    const file = await download.path(),
      metadata = await probeFile(file);
    assert.ok(+metadata.format.duration > 1800);
    assert.ok(Math.abs(+metadata.format.duration - media.duration) < 3);
    if (format === "mp4") {
      assert.ok((await stat(file)).size > 100 * 1024 ** 2);
      assert.equal(
        metadata.streams.find((s) => s.codec_type === "video").height,
        selectedQuality,
      );
    } else assert.ok(metadata.streams.every((s) => s.codec_type === "audio"));
    console.log(
      JSON.stringify({
        complete: format,
        ms: elapsed,
        bytes: +metadata.format.size,
        duration: +metadata.format.duration,
        streams: metadata.streams.map((s) => ({
          type: s.codec_type,
          codec: s.codec_name,
          height: s.height,
        })),
      }),
    );
    await page
      .locator(".workspace")
      .screenshot({ path: `.data/qa/long-${format}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log("선택한 형식의 긴 영상 전체 다운로드 및 모바일 표시 검증 완료");
} finally {
  await browser.close();
}
