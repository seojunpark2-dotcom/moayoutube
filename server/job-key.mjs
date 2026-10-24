export function jobKey({ id, format, quality, bitrate }) {
  return JSON.stringify([
    id,
    format,
    format === "mp4" ? quality : null,
    ["mp3", "m4a", "opus"].includes(format) ? bitrate : null,
  ]);
}
