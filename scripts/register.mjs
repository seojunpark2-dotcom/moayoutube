import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import {
  ROOT,
  inspect,
  library,
  saveLibrary,
  parseURL,
} from "../server/library.mjs";
import { safeSession } from "../server/safe-fetch.mjs";
import { transferToFile } from "../server/transfer.mjs";
const [url, title, author, evidence, convert] = process.argv.slice(2);
if (
  !url ||
  !title ||
  !author ||
  !evidence ||
  !["allow-convert", "download-only"].includes(convert)
)
  throw Error(
    '사용법: npm run register -- "HTTPS 직접 파일 URL" "제목" "제작자" "권한 근거 URL 또는 설명" allow-convert|download-only',
  );
parseURL(url);
const id = randomUUID();
const dir = path.join(ROOT, "library"),
  file = path.join(dir, id + ".mp4");
await mkdir(dir, { recursive: true });
await mkdir(path.join(ROOT, "thumbs"), { recursive: true });
try {
  const session = await safeSession(url);
  try {
    await transferToFile({ file, request: session.request });
  } finally {
    await session.close();
  }
  const media = await inspect(file);
  await promisify(execFile)(
    ffmpeg,
    [
      "-nostdin",
      "-protocol_whitelist",
      "file,pipe",
      "-i",
      file,
      "-frames:v",
      "1",
      "-update",
      "1",
      "-y",
      path.join(ROOT, "thumbs", id + ".jpg"),
    ],
    { timeout: 15000 },
  );
  const items = await library();
  items.push({
    id,
    url: new URL(url).href,
    title,
    author,
    permissionEvidence: evidence,
    allowConvert: convert === "allow-convert",
    file: id + ".mp4",
    media,
  });
  await saveLibrary(items);
  console.log("등록 완료. 서버는 다음 요청부터 자동으로 반영합니다.");
} catch (e) {
  await rm(file, { force: true });
  await rm(path.join(ROOT, "thumbs", id + ".jpg"), { force: true });
  throw e;
}
