import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
function config(extra = {}) {
  const env = { ...process.env };
  for (const key of ["VERCEL", "API_ORIGIN", "NEXT_PUBLIC_DOWNLOAD_ORIGIN"])
    delete env[key];
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'import c from "./next.config.mjs"; console.log(JSON.stringify({env:c.env,routes:await c.rewrites()}));',
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
test("로컬 프록시는 유지하고 배포 다운로드는 API HTTPS 원점으로 직접 연결", () => {
  const local = config();
  assert.equal(local.env.NEXT_PUBLIC_DOWNLOAD_ORIGIN, "");
  assert.equal(local.routes[0].destination, "http://127.0.0.1:4000/api/:path*");
  const deployed = config({
    VERCEL: "1",
    API_ORIGIN: "https://api.example.com/",
  });
  assert.equal(
    deployed.env.NEXT_PUBLIC_DOWNLOAD_ORIGIN,
    "https://api.example.com",
  );
  assert.equal(
    deployed.routes[0].destination,
    "https://api.example.com/api/:path*",
  );
  assert.equal(
    config({
      VERCEL: "1",
      API_ORIGIN: "https://api.example.com",
      NEXT_PUBLIC_DOWNLOAD_ORIGIN: "https://files.example.com",
    }).env.NEXT_PUBLIC_DOWNLOAD_ORIGIN,
    "https://files.example.com",
  );
});
test("Vercel API 누락·HTTP·인증정보·잘못된 원점은 빌드 설정에서 차단", () => {
  for (const value of [
    undefined,
    "http://api.example.com",
    "https://user:pass@api.example.com",
    "https://api.example.com/api",
    "https://api.example.com?q=1",
  ])
    assert.throws(() =>
      config({ VERCEL: "1", ...(value ? { API_ORIGIN: value } : {}) }),
    );
});
