import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
import { probeFile, ROOT } from "../server/library.mjs";
const url = process.argv[2];
if (!url) throw Error("테스트할 공개 YouTube URL을 인수로 지정하세요.");
await mkdir(".data/qa", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  });
  const jobs = [],
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", async (response) => {
    if (
      response.url().endsWith("/api/jobs") &&
      response.request().method() === "POST"
    )
      jobs.push(await response.json());
  });
  await page.goto("http://localhost:3000");
  await page.getByLabel("영상 URL").fill(url);
  await page.getByRole("button", { name: "링크 확인", exact: true }).click();
  await page.locator(".media-text h2").waitFor({ timeout: 60000 });
  await page.getByRole("tab", { name: "음원 다운로드" }).click();
  for (const format of ["original", "mp3"]) {
    await page.getByLabel("파일 형식").selectOption(format);
    assert.equal(
      await page.getByLabel("음원 비트레이트").isDisabled(),
      format === "original",
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      const pending = page.waitForEvent("download", { timeout: 60000 }),
        started = Date.now();
      await page.getByRole("button", { name: "다운로드", exact: true }).click();
      const downloaded = await pending;
      assert.equal(await downloaded.failure(), null);
      const elapsed = Date.now() - started;
      const file = await downloaded.path();
      const metadata = await probeFile(file);
      assert.ok(metadata.streams.every((s) => s.codec_type === "audio"));
      assert.ok(+metadata.format.duration > 0);
      if (format === "original") {
        assert.ok(["aac", "opus"].includes(metadata.streams[0].codec_name));
        assert.match(downloaded.suggestedFilename(), /\.(m4a|opus)$/);
        if (attempt === 0) {
          const input = path.join(
            ROOT,
            "jobs",
            jobs.at(-1).token,
            "source-0.media",
          );
          if (
            await stat(input).then(
              () => true,
              () => false,
            )
          ) {
            const hashes = await Promise.all(
              [input, file].map(async (f) =>
                (
                  await promisify(execFile)(
                    ffmpeg,
                    [
                      "-v",
                      "error",
                      "-protocol_whitelist",
                      "file,pipe",
                      "-i",
                      f,
                      "-map",
                      "0:a:0",
                      "-c",
                      "copy",
                      "-f",
                      "hash",
                      "-hash",
                      "sha256",
                      "-",
                    ],
                    { windowsHide: true, timeout: 15000 },
                  )
                ).stdout.trim(),
              ),
            );
            assert.equal(hashes[0], hashes[1]);
          } else console.log("처리 완료 후 원본 임시 파일 정리 확인");
        }
      } else assert.equal(metadata.streams[0].codec_name, "mp3");
      if (attempt === 1) assert.equal(jobs.at(-1).cached, true);
      console.log(
        JSON.stringify({
          format,
          attempt: attempt + 1,
          ms: elapsed,
          cached: !!jobs.at(-1).cached,
          bytes: +metadata.format.size,
          duration: +metadata.format.duration,
        }),
      );
      await page.getByText("파일 준비가 완료되었습니다").waitFor();
    }
    if (format === "original") {
      await page
        .locator(".workspace")
        .screenshot({ path: ".data/qa/native-fast.png" });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.screenshot({
        path: ".data/qa/native-fast-mobile.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 1280, height: 900 });
    }
  }
  // Switching to a source without native audio must reset the native-only option.
  await page.getByLabel("파일 형식").selectOption("original");
  await page.getByRole("button", { name: "샘플로 체험하기" }).click();
  await page
    .getByRole("heading", { name: "컬러 스튜디오 · 오리지널 테스트 필름" })
    .waitFor();
  await page.getByRole("tab", { name: "음원 다운로드" }).click();
  assert.equal(await page.getByLabel("파일 형식").inputValue(), "mp3");
  assert.deepEqual(errors, []);
  console.log(
    "PC·모바일 원본 음원, 재요청 캐시, 코덱 복사·임시 파일 정리, 일반 소스 전환 확인",
  );
} finally {
  await browser.close();
}
