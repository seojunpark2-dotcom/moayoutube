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
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({
      viewport: { width, height: 1000 },
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
    assert.equal(await page.title(), "모아유튭 · 영상과 소리를 간편하게");
    assert.ok(
      await page
        .getByRole("link", { name: "모아유튭 홈", exact: true })
        .isVisible(),
    );
    assert.equal(
      await page
        .locator(".request-options,.features,.howto,.copyright,footer")
        .count(),
      0,
    );
    assert.ok(
      (await page.locator(".bottom-space").boundingBox()).height >= 500,
    );
    await page
      .getByLabel("영상 URL")
      .fill("https://sample.moadrop.local/studio-loop.mp4");
    await page.getByRole("button", { name: "링크 확인", exact: true }).click();
    await page
      .getByRole("heading", { name: "컬러 스튜디오 · 오리지널 테스트 필름" })
      .waitFor();
    assert.equal(
      await page
        .getByRole("tab", { name: "영상 다운로드", exact: true })
        .getAttribute("aria-selected"),
      "true",
    );
    assert.equal(
      await page.getByLabel("파일 형식", { exact: true }).inputValue(),
      "mp4",
    );
    assert.equal(await page.locator('select[aria-label^="요청"]').count(), 0);
    const result = await page.locator(".result").boundingBox();
    const panel = await page.locator(".local-connection").boundingBox();
    assert.ok(panel.y >= result.y + result.height);
    assert.ok(!(await page.locator("body").innerText()).includes("모아드롭"));
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.waitForTimeout(600);
    await page.screenshot({
      path: `.data/qa/moayoutube-${width}.png`,
      fullPage: true,
    });
    if (width === 1440) {
      const pending = page.waitForEvent("download");
      await page.getByRole("button", { name: "다운로드", exact: true }).click();
      const file = await pending;
      assert.match(file.suggestedFilename(), /\.mp4$/);
      assert.equal(await file.failure(), null);
      await page
        .getByRole("tab", { name: "음원 다운로드", exact: true })
        .click();
      const audioPending = page.waitForEvent("download");
      await page.getByRole("button", { name: "다운로드", exact: true }).click();
      const audio = await audioPending;
      assert.match(audio.suggestedFilename(), /\.mp3$/);
      assert.equal(await audio.failure(), null);
      await page
        .getByRole("button", { name: "링크 확인", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "컬러 스튜디오 · 오리지널 테스트 필름" })
        .waitFor();
      assert.equal(
        await page
          .getByRole("tab", { name: "영상 다운로드", exact: true })
          .getAttribute("aria-selected"),
        "true",
      );
    }
    await page.getByRole("button", { name: "다크 모드로 전환" }).click();
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.deepEqual(errors, []);
    console.log(
      `${width}px: 모아유튭 이름·기본 영상 탭·요청 옵션 제거·연결 안내 위치·하단 여백·다크모드 통과`,
    );
    await page.close();
  }
  console.log("실제 MP4·MP3 저장 및 재조회 시 영상 탭 복귀 통과");
} finally {
  await browser.close();
}
