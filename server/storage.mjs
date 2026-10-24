import { readdir, stat, statfs } from "node:fs/promises";
import path from "node:path";
import {
  MAX_FILE_BYTES,
  MAX_TEMP_BYTES,
  FREE_DISK_RESERVE_BYTES,
} from "./limits.mjs";
export const JOB_RESERVATION_BYTES = 2 * MAX_FILE_BYTES;
export function hasStorage(jobs, freeBytes) {
  const entries = [...jobs];
  const used = entries.reduce(
    (sum, j) => sum + (j.diskBytes ?? JOB_RESERVATION_BYTES),
    0,
  );
  const active = entries.filter((j) => j.state === "processing").length;
  return (
    used + JOB_RESERVATION_BYTES <= MAX_TEMP_BYTES &&
    freeBytes >= JOB_RESERVATION_BYTES * (active + 1) + FREE_DISK_RESERVE_BYTES
  );
}
export async function freeDiskBytes(dir) {
  const fs = await statfs(dir, { bigint: true });
  return Number(fs.bavail * fs.bsize);
}
export async function directoryBytes(dir) {
  try {
    const files = await readdir(dir, { withFileTypes: true });
    return (
      await Promise.all(
        files
          .filter((f) => f.isFile())
          .map(async (f) => (await stat(path.join(dir, f.name))).size),
      )
    ).reduce((a, b) => a + b, 0);
  } catch (e) {
    if (e.code === "ENOENT") return 0;
    throw e;
  }
}
