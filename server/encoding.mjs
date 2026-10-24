export function encodingOptions(cfg, video, audio) {
  if (cfg.copyAudio && cfg.format !== "mp4")
    return ["-map", "0:a:0", "-vn", "-c:a", "copy"];
  if (cfg.format !== "mp4")
    return [
      "-map",
      "0:a:0",
      "-vn",
      "-c:a",
      { mp3: "libmp3lame", m4a: "aac", opus: "libopus" }[cfg.format],
      "-b:a",
      `${cfg.bitrate}k`,
    ];
  const copyVideo =
    video?.codec_name === "h264" && video.height === cfg.quality;
  const options = [
    "-map",
    "0:v:0",
    "-map",
    cfg.audioInput ? "1:a:0" : "0:a:0?",
  ];
  if (copyVideo) options.push("-c:v", "copy");
  else
    options.push(
      "-vf",
      `scale=-2:${cfg.quality}`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
    );
  options.push(
    "-c:a",
    audio?.codec_name === "aac" ? "copy" : "aac",
    "-movflags",
    "+faststart",
  );
  return options;
}
