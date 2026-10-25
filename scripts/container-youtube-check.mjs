import assert from "node:assert/strict";
const base = process.env.CHECK_API || "http://127.0.0.1:4105";
const pause = ms => new Promise(r => setTimeout(r, ms));
const r = await fetch(base + "/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ url: "https://www.youtube.com/watch?v=ucrzIJNVN-s" }), signal: AbortSignal.timeout(60000) });
const media = await r.json();
if (!r.ok || !media.downloadable) {
  console.log(JSON.stringify({ youtubeDownload: "blocked", code: media.downloadErrorCode, reason: media.permission || media.error }));
  process.exit(0);
}
for (const format of ["mp4", "mp3"]) {
  const createdResponse = await fetch(base + "/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: media.id, format, quality: Math.min(...media.qualities), bitrate: 192 }) });
  const created = await createdResponse.json();
  assert.equal(createdResponse.status, 202, JSON.stringify(created));
  let job;
  for (let i = 0; i < 240; i++) {
    job = await fetch(base + "/api/jobs/" + created.token).then(r => r.json());
    if (job.state !== "processing") break;
    await pause(1000);
  }
  if (job.state !== "done") {
    console.log(JSON.stringify({ youtubeDownload: "blocked", format, reason: job.error || job.state }));
    process.exit(0);
  }
  const file = await fetch(base + `/api/jobs/${created.token}/file`);
  assert.equal(file.status, 200);
  const bytes = await file.arrayBuffer();
  assert.ok(bytes.byteLength > 1000);
  console.log(JSON.stringify({ youtubeDownload: "passed", format, bytes: bytes.byteLength }));
}
