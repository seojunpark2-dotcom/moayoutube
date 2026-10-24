import { mkdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpeg from "ffmpeg-static";
import {
  ROOT,
  SAMPLE,
  library,
  saveLibrary,
  inspect,
} from "../server/library.mjs";
await mkdir(path.join(ROOT, "library"), { recursive: true });
await mkdir(path.join(ROOT, "thumbs"), { recursive: true });
const run = promisify(execFile);
const file = path.join(ROOT, "library", "studio.mp4");
await run(
  ffmpeg,
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=1280x720:rate=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=220:sample_rate=44100",
    "-t",
    "8",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "26",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-shortest",
    "-y",
    file,
  ],
  { timeout: 90000 },
);
await run(ffmpeg, [
  "-hide_banner",
  "-loglevel",
  "error",
  "-i",
  file,
  "-frames:v",
  "1",
  "-update",
  "1",
  "-y",
  path.join(ROOT, "thumbs", "studio.jpg"),
]);
const items = (await library()).filter((x) => x.id !== "studio");
items.unshift({
  id: "studio",
  url: SAMPLE,
  title: "컬러 스튜디오 · 오리지널 테스트 필름",
  author: "모아드롭 스튜디오",
  file: "studio.mp4",
  allowConvert: true,
  permissionEvidence:
    "이 프로젝트에서 FFmpeg로 직접 생성한 영상과 사인파 음원 · 다운로드 및 변환 허용",
  media: await inspect(file),
});
await saveLibrary(items);
console.log("샘플 생성 완료: " + SAMPLE);
