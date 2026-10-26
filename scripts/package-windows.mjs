import { mkdir, readFile, writeFile, cp, stat } from "node:fs/promises";
import { createRequire, isBuiltin } from "node:module";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pythonExecutable } from "../server/python.mjs";
import ffmpeg from "ffmpeg-static";
import probe from "ffprobe-static";

if (process.platform !== "win32" || process.arch !== "x64")
  throw Error("Windows x64에서 패키징하세요.");
const root = process.cwd(),
  metadata = JSON.parse(await readFile("package.json", "utf8"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const base = path.join(root, ".data", "dist"),
  dest = path.join(base, `moadrop-windows-${metadata.version}-${stamp}`);
await mkdir(dest, { recursive: true });
async function copy(from, to, options = {}) {
  await cp(path.resolve(from), path.join(dest, to), {
    recursive: true,
    ...options,
  });
}
async function download(url, file, expected) {
  const cache = expected ? path.join(base, "downloads", expected) : null;
  if (cache) {
    try {
      const cached = await readFile(cache);
      if (createHash("sha256").update(cached).digest("hex") === expected) {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, cached);
        return cached;
      }
    } catch {}
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok)
    throw Error(`Download failed: ${new URL(url).hostname} ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (expected && createHash("sha256").update(bytes).digest("hex") !== expected)
    throw Error("공식 실행 파일 체크섬 불일치");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  if (cache) {
    await mkdir(path.dirname(cache), { recursive: true });
    await writeFile(cache, bytes);
  }
  return bytes;
}
const exported = await stat(".next-local/index.html").then(
  () => ".next-local",
  () => "out",
);
await stat(path.join(exported, "index.html"));
await copy(exported, "out");
await copy("server", "server");
await copy("scripts/local-start.mjs", "scripts/local-start.mjs");
await copy("scripts/register-protocol.mjs", "scripts/register-protocol.mjs");
await copy("scripts/protocol-launch.vbs", "scripts/protocol-launch.vbs");
await copy("scripts/register-protocol.cmd", "사이트 연결 등록.cmd");
await copy("scripts/unregister-protocol.cmd", "사이트 연결 해제.cmd");
await writeFile(
  path.join(dest, "사이트 연결 안내.txt"),
  "사이트 버튼으로 실행하기\r\n\r\n1. ZIP 전체를 고정된 폴더에 압축 해제하세요.\r\n2. '사이트 연결 등록.cmd'를 한 번 실행하세요. 관리자 권한은 필요하지 않습니다.\r\n3. https://moayoutube.vercel.app 에서 URL을 입력하고 링크 확인을 누르세요.\r\n4. 브라우저의 프로그램 열기 및 로컬 네트워크 접근 요청을 허용하세요.\r\n\r\n등록 위치: 현재 사용자 HKCU\\Software\\Classes\\moadrop\r\n로그인 시 자동 실행은 설정하지 않습니다.\r\n폴더를 이동하면 다시 등록하세요. 해제는 '사이트 연결 해제.cmd'를 실행하세요.\r\n브라우저나 조직 정책으로 실행이 차단되면 '모아유튭 실행.cmd'를 직접 실행하세요.\r\n사이트의 프로그램 종료 버튼으로 백그라운드 프로그램을 종료할 수 있습니다.\r\n",
);
await copy("scripts/start-local.cmd", "모아유튭 실행.cmd");
// Keep the old filename usable for existing companion instructions.
await copy("scripts/start-local.cmd", "모아드롭 실행.cmd");
await writeFile(
  path.join(dest, "package.json"),
  JSON.stringify(
    {
      name: "moadrop-local",
      version: metadata.version,
      type: "module",
      private: true,
    },
    null,
    2,
  ),
);
const nodeRoot = path.join(root, "node_modules"),
  seen = new Set(),
  inventory = [];
async function dependency(name, parent = root) {
  if (isBuiltin(name)) return;
  const require = createRequire(path.join(parent, "package.json"));
  let folder;
  for (const lookup of require.resolve.paths(name) || []) {
    const candidate = path.join(lookup, name);
    try {
      if (
        JSON.parse(await readFile(path.join(candidate, "package.json"), "utf8"))
          .name === name
      ) {
        folder = candidate;
        break;
      }
    } catch {}
  }
  if (!folder) throw Error("패키지를 찾지 못했습니다: " + name);
  const relative = path.relative(nodeRoot, folder);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw Error("외부 모듈 경로");
  if (seen.has(relative)) return;
  seen.add(relative);
  const pkg = JSON.parse(
    await readFile(path.join(folder, "package.json"), "utf8"),
  );
  inventory.push({
    name: pkg.name,
    version: pkg.version,
    license: pkg.license,
  });
  await copy(folder, path.join("node_modules", relative), {
    filter: (source) => {
      const rel = path.relative(folder, source);
      if (rel.split(path.sep).includes("node_modules")) return false;
      if (
        ["ffmpeg-static", "ffprobe-static"].includes(name) &&
        (/\.(exe|gz)$/.test(source) || rel.split(path.sep)[0] === "bin")
      )
        return false;
      return true;
    },
  });
  for (const child of Object.keys(pkg.dependencies || {}))
    await dependency(child, folder);
}
for (const name of [
  "express",
  "express-rate-limit",
  "undici",
  "ipaddr.js",
  "ffmpeg-static",
  "ffprobe-static",
])
  await dependency(name);
await mkdir(path.join(dest, "runtime"), { recursive: true });
await copy(ffmpeg, "runtime/ffmpeg.exe");
await copy(probe.path, "runtime/ffprobe.exe");
await copy(
  "node_modules/ffmpeg-static/ffmpeg.exe.LICENSE",
  "LICENSES/FFmpeg-LICENSE.txt",
);
await copy(
  "node_modules/ffmpeg-static/ffmpeg.exe.README",
  "LICENSES/FFmpeg-build-and-source.txt",
);
await writeFile(
  path.join(dest, "LICENSES", "npm-packages.json"),
  JSON.stringify(inventory, null, 2),
);
const nodeVersion = process.version;
const sums = await fetch(
  `https://nodejs.org/dist/${nodeVersion}/SHASUMS256.txt`,
  { signal: AbortSignal.timeout(20000) },
).then((r) => {
  if (!r.ok) throw Error("Node checksum unavailable");
  return r.text();
});
const hash = sums
  .split(/\r?\n/)
  .find((line) => line.trim().endsWith("win-x64/node.exe"))
  ?.split(/\s+/)[0];
if (!hash) throw Error("Node x64 checksum unavailable");
await download(
  `https://nodejs.org/dist/${nodeVersion}/win-x64/node.exe`,
  path.join(dest, "runtime", "node.exe"),
  hash,
);
await download(
  `https://raw.githubusercontent.com/nodejs/node/${nodeVersion}/LICENSE`,
  path.join(dest, "LICENSES", "Node-LICENSE.txt"),
);
const pythonVersion = "3.14.10",
  pythonHash =
    "90905e64a840557d8c1bc4f5b74db3d7ee85e3ffb217611cac1c7813acea4159";
const archive = path.join(base, `python-${pythonVersion}-embed-amd64.zip`);
await download(
  `https://www.python.org/ftp/python/${pythonVersion}/python-${pythonVersion}-embed-amd64.zip`,
  archive,
  pythonHash,
);
const target = path.join(dest, "runtime", "python");
await mkdir(target, { recursive: true });
const extraction = spawnSync(
  pythonExecutable(),
  [
    "-c",
    "import zipfile,sys,pathlib; z=zipfile.ZipFile(sys.argv[1]); root=pathlib.Path(sys.argv[2]).resolve(); assert all((root / n).resolve().is_relative_to(root) for n in z.namelist()); z.extractall(root)",
    archive,
    target,
  ],
  { stdio: "inherit", windowsHide: true },
);
if (extraction.status !== 0) throw Error("Python runtime extraction failed");
await writeFile(
  path.join(target, "python314._pth"),
  "python314.zip\n.\n../../.tools/python\n",
);
await copy(".tools/python", ".tools/python", {
  filter: (source) =>
    !source
      .split(path.sep)
      .some((p) => ["__pycache__", "bin", "share"].includes(p)),
});
await copy(".data/library/studio.mp4", ".data/library/studio.mp4");
await copy(".data/thumbs/studio.jpg", ".data/thumbs/studio.jpg");
const library = JSON.parse(await readFile(".data/library.json", "utf8"));
await writeFile(
  path.join(dest, ".data", "library.json"),
  JSON.stringify(
    library.filter((item) => item.id === "studio"),
    null,
    2,
  ),
);
await writeFile(
  path.join(dest, "시작 안내.txt"),
  "모아유튭 Windows 로컬 실행\r\n\r\n1. ZIP 전체를 원하는 폴더에 압축 해제하세요.\r\n2. '모아유튭 실행.cmd'를 더블클릭하세요.\r\n3. 브라우저의 로컬 화면에서 URL을 입력하세요.\r\n4. 종료할 때 실행 창에서 Ctrl+C를 누르세요.\r\n\r\n기본 주소: http://127.0.0.1:47831/\r\n다운로드·변환은 이 PC에서 실행됩니다. Windows x64용이며 macOS·모바일용이 아닙니다.\r\n처리 중 프로그램 창을 닫지 마세요. 인증·DRM·접근 제한은 우회하지 않습니다.\r\nFFmpeg GPL 라이선스와 빌드 소스 위치는 LICENSES 폴더를 확인하세요.\r\n",
);
await writeFile(
  path.join(dest, "LICENSES", "sources.txt"),
  "Node.js: https://nodejs.org/dist/" +
    nodeVersion +
    "/\nPython: https://www.python.org/downloads/release/python-31410/\nyt-dlp: https://github.com/yt-dlp/yt-dlp/tree/2026.10.21\nFFmpeg build: https://www.gyan.dev/ffmpeg/builds/\nFFmpeg exact source: https://github.com/FFmpeg/FFmpeg/commit/e38092ef93\nffprobe-static: https://github.com/joshwnj/ffprobe-static\nPython dependencies retain their dist-info licenses.\n",
);
const zip = dest + ".zip";
const packed = spawnSync(
  pythonExecutable(),
  [
    "-c",
    "import pathlib,sys,zipfile; root=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2],'x',zipfile.ZIP_DEFLATED,compresslevel=6); [z.write(p,p.relative_to(root)) for p in root.rglob('*') if p.is_file()]; z.close()",
    dest,
    zip,
  ],
  { stdio: "inherit", windowsHide: true },
);
if (packed.status !== 0) throw Error("ZIP packaging failed");
const bytes = await readFile(zip),
  digest = createHash("sha256").update(bytes).digest("hex");
await writeFile(zip + ".sha256", digest + "  " + path.basename(zip) + "\n");
await writeFile(
  path.join(base, "latest-package.json"),
  JSON.stringify(
    {
      directory: dest,
      zip,
      sha256: digest,
      bytes: bytes.length,
      node: nodeVersion,
      python: pythonVersion,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ directory: dest, zip, bytes: bytes.length, sha256: digest }),
);
