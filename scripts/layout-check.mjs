import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const web = process.env.CHECK_WEB || "http://127.0.0.1:47831";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  if (web.startsWith("https:")) {
    const cdp = await browser.newBrowserCDPSession();
    await cdp.send("Browser.grantPermissions", {
      origin: new URL(web).origin,
      permissions: ["localNetworkAccess", "localNetwork", "loopbackNetwork"],
    });
  }
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
    [320, 568],
    [844, 390],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      acceptDownloads: true,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(web);
    if (web.startsWith("https:"))
      await page
        .getByRole("button", { name: "내 PC 연결하기", exact: true })
        .click();
    await page.getByText("내 PC에 연결됨", { exact: true }).waitFor();
    assert.equal(
      await page
        .locator("header,.hero,.brand,.bottom-space,.features,footer")
        .count(),
      0,
    );
    const box = await page.locator(".workspace").boundingBox();
    assert.ok(Math.abs(box.x + box.width / 2 - width / 2) < 2);
    assert.ok(Math.abs(box.y + box.height / 2 - height / 2) < 2);
    await page.screenshot({
      path: `.data/qa/fixed-empty-${width}-${height}.png`,
      fullPage: true,
    });
    await page
      .getByLabel("영상 URL")
      .fill("https://sample.moadrop.local/studio-loop.mp4");
    await page.getByRole("button", { name: "링크 확인", exact: true }).click();
    await page
      .getByRole("tab", { name: "영상 다운로드", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("tab", { name: "영상 다운로드", exact: true })
        .getAttribute("aria-selected"),
      "true",
    );
    assert.ok(
      await page.evaluate(
        () =>
          document.documentElement.scrollHeight <= innerHeight + 1 &&
          document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.mouse.move(1, 1);
    await page.mouse.wheel(0, 1000);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => scrollY), 0);
    if (width === 1440) {
      for (const kind of ["video", "audio"]) {
        if (kind === "audio")
          await page
            .getByRole("tab", { name: "음원 다운로드", exact: true })
            .click();
        const pending = page.waitForEvent("download");
        await page
          .getByRole("button", { name: "다운로드", exact: true })
          .click();
        const file = await pending;
        assert.equal(await file.failure(), null);
        assert.ok(
          file.suggestedFilename().endsWith(kind === "video" ? ".mp4" : ".mp3"),
        );
      }
    }
    await page.locator(".workspace").evaluate((el) => (el.scrollTop = 0));
    await page.screenshot({
      path: `.data/qa/fixed-result-${width}-${height}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "다크 모드로 전환" }).click();
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    assert.deepEqual(errors, []);
    console.log(
      `${width}×${height}: 소개 전체 제거·중앙 고정·문서 스크롤 차단·조작/다크모드 통과`,
    );
    await page.close();
  }
  console.log("실제 MP4·MP3 저장 통과");
} finally {
  await browser.close();
}
