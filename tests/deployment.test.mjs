import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
function config(extra = {}) {
  const env = { ...process.env };
  for (const key of [
    "VERCEL",
    "API_ORIGIN",
    "NEXT_PUBLIC_DOWNLOAD_ORIGIN",
    "COMPANION_DOWNLOAD_URL",
  ])
    delete env[key];
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'import c from "./next.config.mjs"; console.log(JSON.stringify({env:c.env,routes:await c.rewrites?.()||[]}));',
      ],
      {
        env: { ...env, ...extra },
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  );
}
test("Vercel과 로컬 모두 클라우드 API 프록시를 사용하지 않음", () => {
  const local = config();
  assert.deepEqual(local.routes, []);
  const deployed = config({
    VERCEL: "1",
    API_ORIGIN: "https://api.example.com/",
  });
  assert.deepEqual(deployed.routes, []);
  assert.equal(deployed.env.NEXT_PUBLIC_DOWNLOAD_ORIGIN, undefined);
  assert.deepEqual(config({ VERCEL: "1" }).routes, []);
});
test("실행 프로그램 배포 링크는 인증정보 없는 HTTPS만 허용", () => {
  for (const value of [
    "http://api.example.com",
    "https://user:pass@api.example.com",
    "javascript:alert(1)",
  ])
    assert.throws(() => config({ VERCEL: "1", COMPANION_DOWNLOAD_URL: value }));
});
