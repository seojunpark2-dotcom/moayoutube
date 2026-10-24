// Run against a production build with API_ORIGIN=http://127.0.0.1:4000.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { probeFile } from "../server/library.mjs";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.argv[2] || "http://127.0.0.1:3100");
  await page.getByRole("button", { name: "샘플로 체험하기" }).click();
  await page.locator(".media-text h2").waitFor();
  for (const format of ["mp4", "mp3"]) {
    if (format === "mp3")
      await page.getByRole("tab", { name: "음원 다운로드" }).click();
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "다운로드", exact: true }).click();
    const download = await pending;
    assert.equal(new URL(download.url()).origin, "http://127.0.0.1:4000");
    assert.equal(await download.failure(), null);
    const actual = await probeFile(await download.path());
    assert.ok(+actual.format.duration >= 8);
    assert.match(
      download.suggestedFilename(),
      new RegExp("\\." + format + "$"),
    );
    console.log(
      `${format}: production UI → API rewrite → FFmpeg → direct file origin verified`,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
