function downloadURL(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash)
    throw Error(
      "로컬 프로그램 다운로드에는 인증 정보 없는 HTTPS 주소가 필요합니다.",
    );
  return url.href;
}
const config = {
  ...(process.env.LOCAL_EXPORT === "1"
    ? { output: "export", distDir: ".next-local" }
    : {}),
  env: {
    NEXT_PUBLIC_COMPANION_DOWNLOAD_URL: downloadURL(
      process.env.COMPANION_DOWNLOAD_URL ||
        "https://github.com/seojunpark2-dotcom/moayoutube-local/releases/latest/download/moayoutube-local-windows-x64.zip",
    ),
  },
  devIndicators: false,
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
if (process.env.LOCAL_EXPORT === "1") delete config.headers;
export default config;
