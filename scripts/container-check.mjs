import assert from "node:assert/strict";
const base = process.env.CHECK_API || "http://127.0.0.1:4105";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let ready = false;
for (let i = 0; i < 180; i++) {
  try {
    const h = await fetch(base + "/api/health", {
      signal: AbortSignal.timeout(2000),
    }).then((r) => r.json());
    const samples = await fetch(base + "/api/samples").then((r) => r.json());
    if (
      h.youtubeProvider === "cobalt" &&
      samples.some((s) => s.id === "studio")
    ) {
      ready = true;
      break;
    }
  } catch {}
  await pause(1000);
}
assert.ok(ready, "Cobalt 및 샘플 준비 시간 초과");
for (const format of ["mp4", "mp3"]) {
  const r = await fetch(base + "/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "studio", format, quality: 360, bitrate: 192 }),
  });
  const created = await r.json();
  assert.equal(r.status, 202, JSON.stringify(created));
  let job;
  for (let n = 0; n < 180; n++) {
    job = await fetch(base + "/api/jobs/" + created.token).then((r) =>
      r.json(),
    );
    if (job.state !== "processing") break;
    await pause(1000);
  }
  assert.equal(job.state, "done", JSON.stringify(job));
  const file = await fetch(base + `/api/jobs/${created.token}/file`);
  assert.equal(file.status, 200);
  const bytes = await file.arrayBuffer();
  assert.ok(bytes.byteLength > 1000);
  console.log(
    `실제 컨테이너 ${format} 다운로드 검증: ${bytes.byteLength} bytes`,
  );
}
