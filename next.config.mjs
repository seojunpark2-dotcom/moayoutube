function origin(value, name) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw Error(`${name}에는 인증 정보·경로 없는 HTTP(S) 원점을 지정하세요.`);
  if (process.env.VERCEL === "1" && url.protocol !== "https:")
    throw Error(`${name}에는 공개 HTTPS 주소가 필요합니다.`);
  return url.origin;
}
if (process.env.VERCEL === "1" && !process.env.API_ORIGIN)
  throw Error(
    "Vercel 환경 변수 API_ORIGIN에 별도 변환 서버의 HTTPS 주소를 설정하세요. DEPLOYMENT.md를 참고하세요.",
  );
const apiOrigin = origin(
  process.env.API_ORIGIN || "http://127.0.0.1:4000",
  "API_ORIGIN",
);
const downloadOrigin =
  process.env.NEXT_PUBLIC_DOWNLOAD_ORIGIN || process.env.API_ORIGIN;
export default {
  env: {
    NEXT_PUBLIC_DOWNLOAD_ORIGIN: downloadOrigin
      ? origin(downloadOrigin, "NEXT_PUBLIC_DOWNLOAD_ORIGIN")
      : "",
  },
  devIndicators: false,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiOrigin}/api/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};
