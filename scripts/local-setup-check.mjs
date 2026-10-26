import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const web = process.env.CHECK_WEB || "http://127.0.0.1:47831";
const sample = "https://sample.moadrop.local/studio-loop.mp4";
const browser = await chromium.launch({ channel: "msedge", headless: true });
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
    await page.getByRole("button", { name: "링크 확인", exact: true }).click();
    await page
      .getByRole("button", { name: "연결 대기 취소", exact: true })
      .waitFor();
    assert.equal(await page.locator(".local-setup").count(), 0);
    assert.equal(
      await page.getByText("첫 실행 준비", { exact: true }).count(),
      0,
    );
    assert.ok(await page.getByText("로딩 중…", { exact: true }).isVisible());
    assert.equal(analyses, 0);
    await page.screenshot({
      path: `.data/qa/startup-loading-${width}.png`,
      fullPage: true,
    });
    available = true;
    await page
      .getByRole("tab", { name: "영상 다운로드", exact: true })
      .waitFor({ timeout: 15000 });
    assert.equal(analyses, 1);
    assert.equal(await page.locator(".startup-loading").count(), 0);
    await page.getByRole("tab", { name: "음원 다운로드", exact: true }).click();
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "다운로드", exact: true }).click();
    assert.equal(await (await pending).failure(), null);
    console.log(
      `${width}px: 첫 실행 안내 제거·로딩 표시·자동 조회 재개·실제 MP3 저장 통과`,
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
    .getByRole("button", { name: "연결 대기 취소", exact: true })
    .click();
  available = true;
  await page.waitForTimeout(1000);
  assert.equal(analyses, 0);
  assert.ok(await page.getByLabel("영상 URL").isEnabled());
  await page.getByRole("button", { name: "링크 확인", exact: true }).click();
  await page.getByRole("tab", { name: "영상 다운로드", exact: true }).waitFor();
  assert.equal(analyses, 1);
  available = false;
  await page.getByRole("button", { name: "링크 확인", exact: true }).click();
  await page
    .getByRole("button", { name: "연결 대기 취소", exact: true })
    .waitFor();
  available = true;
  await page.getByRole("tab", { name: "영상 다운로드", exact: true }).waitFor();
  assert.equal(analyses, 2);
  await context.close();
  console.log("취소·재조회·끊긴 연결 자동 재개 통과");
  const timeoutContext = await browser.newContext();
  const timeoutPage = await timeoutContext.newPage();
  await timeoutPage.clock.install();
  await timeoutContext.route("**/api/health", (r) =>
    r.abort("connectionrefused"),
  );
  await timeoutPage.goto(web);
  await timeoutPage.getByLabel("영상 URL").fill(sample);
  await timeoutPage
    .getByRole("button", { name: "링크 확인", exact: true })
    .click();
  await timeoutPage
    .getByRole("button", { name: "연결 대기 취소", exact: true })
    .waitFor();
  await timeoutPage.clock.fastForward(46000);
  await timeoutPage
    .getByText("실행 프로그램에 연결하지 못했습니다.", { exact: true })
    .waitFor();
  assert.equal(await timeoutPage.locator(".startup-loading").count(), 0);
  await timeoutPage
    .getByRole("button", { name: "다시 시도", exact: true })
    .click();
  await timeoutPage.locator(".startup-loading").waitFor();
  await timeoutPage
    .getByRole("button", { name: "연결 대기 취소", exact: true })
    .click();
  assert.ok(await timeoutPage.getByLabel("영상 URL").isEnabled());
  console.log("45초 제한·실패 안내·재시도·취소 통과");
  await timeoutContext.close();
} finally {
  await browser.close();
}
