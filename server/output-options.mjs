export const MP3_BITRATES = [96, 128, 256, 320];
export const VIDEO_QUALITIES = [144, 360, 480, 720, 1080];
export function analysisKey(id, { format = "mp4", quality = 720 } = {}) {
  return `${id}|${format === "mp4" ? `video:${quality}` : "audio"}`;
}
