import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const web = process.env.CHECK_WEB || "http://127.0.0.1:47831";
const sample = "https://sample.moadrop.local/studio-loop.mp4";
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      acceptDownloads: true,
    });
    const page = await context.newPage();
    let available = false,
      analyses = 0;
    await context.route("**/api/health", (r) =>
      available ? r.continue() : r.abort("connectionrefused"),
    );
    page.on("request", (r) => {
      if (new URL(r.url()).pathname === "/api/analyze") analyses++;
    });
    await page.goto(web);
    await page.getByLabel("영상 URL").fill(sample);
    await page
      .getByLabel("요청 음원 비트레이트", { exact: true })
      .selectOption("256");
    await page.getByRole("button", { name: "링크 확인", exact: true }).click();
    await page
      .getByRole("heading", { name: "첫 실행 준비", exact: true })
      .waitFor();
    assert.equal(analyses, 0);
    assert.match(
      await page
        .getByRole("link", { name: "Windows 실행 ZIP 받기", exact: true })
        .getAttribute("href"),
      /^https:\/\/github.com\//,
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: `.data/qa/setup-${width}.png`,
      fullPage: true,
    });
    available = true;
    await page
      .getByRole("heading", { name: "컬러 스튜디오 · 오리지널 테스트 필름" })
      .waitFor({ timeout: 15000 });
    assert.equal(analyses, 1);
    assert.equal(
      await page.getByLabel("음원 비트레이트", { exact: true }).inputValue(),
      "256",
    );
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "다운로드", exact: true }).click();
    const download = await pending;
    assert.equal(await download.failure(), null);
    assert.match(download.suggestedFilename(), /\.mp3$/);
    console.log(
      `${width}px: 준비 안내 → 프로그램 감지 → 입력한 URL·비트레이트 유지 → 실제 MP3 저장 통과`,
    );
    await context.close();
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  let available = false,
    analyses = 0;
  await context.route("**/api/health", (r) =>
    available ? r.continue() : r.abort("connectionrefused"),
  );
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/analyze") analyses++;
  });
  await page.goto(web);
  await page.getByLabel("영상 URL").fill(sample);
  await page.getByRole("button", { name: "링크 확인", exact: true }).click();
  await page
    .getByRole("heading", { name: "첫 실행 준비", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "준비 안내 닫기", exact: true })
    .click();
  available = true;
  await page.waitForTimeout(2500);
  assert.equal(analyses, 0);
  await page.getByRole("button", { name: "링크 확인", exact: true }).click();
  await page
    .getByRole("heading", { name: "컬러 스튜디오 · 오리지널 테스트 필름" })
    .waitFor();
  assert.equal(analyses, 1);
  console.log(
    "안내 취소 시 자동 작업 중단 / 프로그램 실행 중이면 링크 입력만으로 자동 연결 통과",
  );
  await context.close();
} finally {
  await browser.close();
}
