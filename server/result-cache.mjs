import {
  readdir,
  readFile,
  writeFile,
  rename,
  lstat,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { MAX_FILE_BYTES } from "./limits.mjs";
export const RESULT_TTL_MS = 24 * 60 * 60_000;
export const RESULT_CACHE_BYTES = 2 * 1024 ** 3;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const formats = ["mp4", "mp3", "m4a", "opus"];

export async function saveResult(job) {
  const size = (await lstat(job.output)).size;
  const value = {
    token: job.token,
    key: job.key,
    title: job.title,
    format: job.format,
    created: job.created,
    completedAt: job.completedAt,
    bytes: size,
    duration: job.duration,
    height: job.height || null,
    author: job.author || "저장된 결과",
  };
  const target = path.join(job.dir, "manifest.json");
  await writeFile(target + ".tmp", JSON.stringify(value));
  await rename(target + ".tmp", target);
}

export async function restoreResults(root, now = Date.now()) {
  const jobs = new Map();
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const dir = path.join(root, entry.name);
    try {
      if (!entry.isDirectory() || !uuid.test(entry.name)) throw Error();
      const manifest = path.join(dir, "manifest.json");
      const meta = await lstat(manifest);
      if (!meta.isFile() || meta.size > 8192) throw Error();
      const value = JSON.parse(await readFile(manifest, "utf8"));
      if (
        value.token !== entry.name ||
        !formats.includes(value.format) ||
        typeof value.key !== "string" ||
        value.key.length > 512 ||
        typeof value.title !== "string" ||
        value.title.length > 1000 ||
        !Number.isFinite(value.duration) ||
        value.duration <= 0 ||
        !Number.isFinite(value.completedAt) ||
        now - value.completedAt >= RESULT_TTL_MS ||
        value.completedAt > now + 60_000 ||
        !Number.isFinite(value.created)
      )
        throw Error();
      const key = JSON.parse(value.key);
      if (
        !Array.isArray(key) ||
        key.length !== 4 ||
        ![...formats, "original"].includes(key[1])
      )
        throw Error();
      const output = path.join(dir, "result." + value.format);
      const file = await lstat(output);
      if (
        !file.isFile() ||
        file.size !== value.bytes ||
        file.size <= 0 ||
        file.size >= MAX_FILE_BYTES
      )
        throw Error();
      jobs.set(value.token, {
        ...value,
        dir,
        output,
        state: "done",
        progress: 100,
        phase: "complete",
        child: null,
        diskBytes: file.size + meta.size,
      });
    } catch {
      // readdir supplies a single basename; removal never follows a symlink.
      await rm(dir, { recursive: true, force: true });
    }
  }
  await pruneResults(jobs, now);
  return jobs;
}

export async function pruneResults(jobs, now = Date.now()) {
  const completed = [...jobs.values()]
    .filter((j) => j.state !== "processing")
    .sort(
      (a, b) => (a.completedAt || a.created) - (b.completedAt || b.created),
    );
  let bytes = completed.reduce((n, j) => n + (j.diskBytes || j.bytes || 0), 0);
  let count = completed.length;
  for (const job of completed) {
    if (
      now - (job.completedAt || job.created) <
        (job.state === "error" ? 15 * 60000 : RESULT_TTL_MS) &&
      bytes <= RESULT_CACHE_BYTES &&
      count <= 18
    )
      continue;
    jobs.delete(job.token);
    bytes -= job.diskBytes || job.bytes || 0;
    count--;
    await rm(job.dir, { recursive: true, force: true });
  }
}
