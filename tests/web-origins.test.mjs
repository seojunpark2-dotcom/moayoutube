import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedWebOrigin } from "../server/web-origins.mjs";

test("이 프로젝트의 기본·팀·배포·브랜치 Vercel 주소만 허용", () => {
  for (const host of [
    "moayoutube.vercel.app",
    "moayoutube-seojunpark2.vercel.app",
    "moayoutube-hu8lnfe7e-seojunpark2.vercel.app",
    "moayoutube-git-main-seojunpark2.vercel.app",
    "moayoutube-git-7083fe4cc2c2fbe6fe98d2bcd9b19-b4c3e9-seojunpark2.vercel.app",
  ])
    assert.equal(isAllowedWebOrigin(`https://${host}`, {}), true, host);
});

test("다른 프로젝트·다른 팀·유사 도메인·인증·포트·불투명 출처는 거절", () => {
  for (const origin of [
    "https://other.vercel.app",
    "https://moayoutube-otherteam.vercel.app",
    "https://other-hu8lnfe7e-seojunpark2.vercel.app",
    "https://moayoutube-hu8lnfe7e-otherteam.vercel.app",
    "https://moayoutube-git-main-seojunpark2.vercel.app.evil.test",
    "https://moayoutube.vercel.app.evil.test",
    "https://moayoutube.vercel.app@evil.test",
    "https://user:password@moayoutube.vercel.app",
    "https://moayoutube.vercel.app:8443",
    "http://moayoutube.vercel.app",
    "https://moayoutube.vercel.app/path",
    "https://moayoutube.vercel.app/",
    "null",
    "",
    "bad",
  ])
    assert.equal(isAllowedWebOrigin(origin, {}), false, origin);
});

test("기존 로컬·Origin 없는 요청과 명시한 여러 사용자 도메인 지원", () => {
  assert.equal(isAllowedWebOrigin(undefined, {}), true);
  assert.equal(isAllowedWebOrigin("http://localhost:3000", {}), true);
  const env = {
    WEB_ORIGIN: " https://custom.example/ ",
    WEB_ORIGINS: "https://one.example/, https://two.example",
  };
  for (const origin of [
    "https://custom.example",
    "https://one.example",
    "https://two.example",
  ])
    assert.equal(isAllowedWebOrigin(origin, env), true);
  assert.equal(
    isAllowedWebOrigin("https://evil.test", {
      WEB_ORIGIN: "https://evil.test/path",
    }),
    false,
  );
});
