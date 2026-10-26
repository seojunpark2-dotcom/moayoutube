// Functional browser tests for the requested desktop/mobile layouts.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
await mkdir(".data/qa", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const web = process.env.CHECK_WEB || "http://localhost:3000";
async function connect(page) {
  const button = page.getByRole("button", {
    name: "내 PC 연결하기",
    exact: true,
  });
  if (await button.isVisible()) await button.click();
  await page.getByText("내 PC에 연결됨", { exact: true }).waitFor();
}
const youtubeURL =
  process.argv[2] || "https://www.youtube.com/watch?v=jNQXAC9IVRw";
try {
  for (const width of process.argv.includes("--youtube-only")
    ? []
    : [1440, 675, 390, 320]) {
    const page = await browser.newPage({
      viewport: { width, height: width > 800 ? 1050 : 844 },
      acceptDownloads: true,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(web);
    await connect(page);
    assert.equal(await page.locator(".request-options").count(), 0);
    await page.getByRole("button", { name: "샘플로 체험하기" }).click();
    await page
      .getByRole("heading", { name: "컬러 스튜디오 · 오리지널 테스트 필름" })
      .waitFor();
    assert.equal(
      await page.locator('select[aria-label="영상 화질"] option').count(),
      3,
    );
    assert.equal(
      await page
        .locator("img")
        .evaluate((img) => img.complete && img.naturalWidth > 0),
      true,
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `가로 넘침 ${width}`,
    );
    await page.getByRole("tab", { name: "음원 다운로드" }).click();
    await page
      .getByLabel("음원 비트레이트", { exact: true })
      .selectOption(width === 390 ? "320" : width === 320 ? "96" : "256");
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: "다운로드", exact: true }).click();
    const download = await downloaded;
    assert.match(download.suggestedFilename(), /\.mp3$/);
    assert.equal(await download.failure(), null);
    await page.getByText("파일 준비가 완료되었습니다").waitFor();
    await page.screenshot({
      path: `.data/qa/light-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "다크 모드로 전환" }).click();
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    await page.screenshot({
      path: `.data/qa/dark-${width}.png`,
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `결과 화면 넘침 ${width}`,
    );
    assert.deepEqual(errors, []);
    console.log(
      `${width}px: 썸네일·샘플 분석·MP3 저장·다크모드·가로 넘침 없음 확인`,
    );
    await page.close();
  }
  if (!process.argv.includes("--sample-only")) {
    const page = await browser.newPage();
    await page.goto(web);
    await connect(page);
    await page.getByLabel("영상 URL").fill(youtubeURL);
    await page.getByRole("button", { name: "링크 확인", exact: true }).click();
    await page.locator(".media-text h2").waitFor({ timeout: 60_000 });
    assert.ok(
      await page.getByRole("tab", { name: "음원 다운로드" }).isEnabled(),
    );
    const qualityOptions = await page
      .getByLabel("영상 화질", { exact: true })
      .locator("option")
      .allTextContents();
    assert.ok(qualityOptions.length > 0);
    for (const format of ["mp4", "mp3"]) {
      const started = Date.now();
      if (format === "mp3")
        await page.getByRole("tab", { name: "음원 다운로드" }).click();
      const pending = page.waitForEvent("download", { timeout: 90000 });
      await page.getByRole("button", { name: "다운로드", exact: true }).click();
      const download = await pending;
      assert.ok(download.suggestedFilename().endsWith("." + format));
      assert.equal(await download.failure(), null);
      await page.getByText("파일 준비가 완료되었습니다").waitFor();
      console.log(
        `YouTube ${format.toUpperCase()} 실제 다운로드 통과: ${Date.now() - started}ms`,
      );
    }
    await page.screenshot({
      path: ".data/qa/youtube-download.png",
      fullPage: true,
    });
    await page.getByLabel("영상 URL").fill("잘못된 링크");
    await page.getByRole("button", { name: "링크 확인", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "올바른 영상 URL" })
      .waitFor();
    console.log("잘못된 링크에 한국어 오류 안내 확인");
    await page.close();
  }
} finally {
  await browser.close();
}
