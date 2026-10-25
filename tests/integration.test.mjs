import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, rm, mkdir } from "node:fs/promises";
import probe from "ffprobe-static";

test(
  "동일 요청 공유·동시 변환 2개 제한·완료 파일 재사용",
  { timeout: 30000 },
  async () => {
    const child = spawn(process.execPath, ["server/index.mjs"], {
      env: { ...process.env, API_PORT: "4101", NODE_ENV: "test" },
      stdio: "pipe",
      windowsHide: true,
    });
    child.stderr.resume();
    child.stdout.resume();
    try {
      let ready = false;
      for (let i = 0; i < 50; i++) {
        try {
          if ((await fetch("http://127.0.0.1:4101/api/health")).ok) {
            ready = true;
            break;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(ready);
      const results = await Promise.all(
        [720, 720, 480, 360].map((quality) =>
          fetch("http://127.0.0.1:4101/api/jobs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: "studio", format: "mp4", quality }),
          }),
        ),
      );
      assert.deepEqual(
        results.map((r) => r.status).sort(),
        [202, 202, 202, 429],
      );
      const first = await results[0].clone().json(),
        duplicate = await results[1].clone().json();
      assert.equal(first.token, duplicate.token);
      const denied = results.find((r) => r.status === 429);
      assert.match((await denied.json()).error, /다른 변환/);
      for (const response of results.filter((r) => r.status === 202)) {
        const { token } = await response.json();
        let state;
        for (let i = 0; i < 100; i++) {
          state = await (
            await fetch("http://127.0.0.1:4101/api/jobs/" + token)
          ).json();
          if (state.state !== "processing") break;
          await new Promise((r) => setTimeout(r, 100));
        }
        assert.equal(state.state, "done");
      }
      const reused = await fetch("http://127.0.0.1:4101/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "studio", format: "mp4", quality: 720 }),
      });
      assert.equal(reused.status, 200);
      const hit = await reused.json();
      assert.equal(hit.token, first.token);
      assert.equal(hit.cached, true);
    } finally {
      child.kill();
      await new Promise((r) => setTimeout(r, 300));
    }
  },
);
const base = "http://127.0.0.1:4100";

test(
  "호스팅 PORT가 API_PORT보다 우선하며 실제 지정 포트에서 응답",
  { timeout: 15000 },
  async () => {
    const child = spawn(process.execPath, ["server/index.mjs"], {
      env: {
        ...process.env,
        PORT: "4312",
        API_PORT: "4313",
        API_HOST: "127.0.0.1",
        NODE_ENV: "test",
      },
      stdio: "pipe",
      windowsHide: true,
    });
    let logs = "";
    child.stdout.on("data", (chunk) => (logs += chunk));
    child.stderr.resume();
    try {
      let health;
      for (let i = 0; i < 50; i++) {
        try {
          const response = await fetch("http://127.0.0.1:4312/api/health");
          if (response.ok) {
            health = await response.json();
            break;
          }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(health?.ok, true);
      assert.match(logs, /변환 API 포트: 4312/);
    } finally {
      child.kill();
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  },
);
async function post(route, body) {
  return fetch(base + route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
test(
  "실제 API → FFmpeg → 다운로드: 4개 형식과 권한 차단",
  { timeout: 120000 },
  async () => {
    const child = spawn(process.execPath, ["server/index.mjs"], {
      env: { ...process.env, API_PORT: "4100", NODE_ENV: "test" },
      stdio: "pipe",
      windowsHide: true,
    });
    let logs = "";
    child.stderr.on("data", (d) => (logs += d));
    try {
      let ready = false;
      for (let i = 0; i < 50; i++) {
        try {
          if ((await fetch(base + "/api/health")).ok) {
            ready = true;
            break;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 200));
      }
      assert.ok(ready, logs);
      const analyzed = await post("/api/analyze", {
        url: "https://sample.moadrop.local/studio-loop.mp4",
      });
      assert.equal(analyzed.status, 200);
      const media = await analyzed.json();
      assert.deepEqual(media.qualities, [720, 480, 360]);
      assert.ok(media.duration > 7);
      for (const url of [
        "https://127.0.0.1/secret",
        "https://169.254.169.254/latest/meta-data",
        "https://example.com/not-approved.mp4",
      ])
        assert.equal((await post("/api/analyze", { url })).status, 422);
      assert.equal(
        (
          await post("/api/jobs", {
            id: "youtube-unapproved",
            format: "mp4",
            quality: 720,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await post("/api/jobs", {
            id: media.id,
            format: "mp4",
            quality: 1080,
          })
        ).status,
        400,
      );
      assert.equal(
        (await post("/api/jobs", { id: media.id, format: "mp3", bitrate: 999 }))
          .status,
        400,
      );
      await mkdir(".data/test-output", { recursive: true });
      for (const format of ["mp4", "mp3", "m4a", "opus"]) {
        const response = await post("/api/jobs", {
          id: media.id,
          format,
          quality: 360,
          bitrate: 192,
        });
        assert.equal(response.status, 202);
        const { token } = await response.json();
        let job;
        for (let i = 0; i < 150; i++) {
          job = await (await fetch(base + "/api/jobs/" + token)).json();
          if (job.state !== "processing") break;
          await new Promise((r) => setTimeout(r, 200));
        }
        assert.equal(job.state, "done", JSON.stringify(job));
        const file = await fetch(base + "/api/jobs/" + token + "/file");
        assert.equal(file.status, 200);
        assert.match(file.headers.get("content-disposition"), /attachment/);
        const bytes = Buffer.from(await file.arrayBuffer());
        assert.ok(bytes.length > 1000);
        const local = ".data/test-output/test." + format;
        await writeFile(local, bytes);
        const { stdout } = await promisify(execFile)(probe.path, [
          "-v",
          "error",
          "-show_format",
          "-show_streams",
          "-of",
          "json",
          local,
        ]);
        const info = JSON.parse(stdout);
        assert.ok(+info.format.duration > 7);
        assert.ok(info.streams.some((s) => s.codec_type === "audio"));
        if (format === "mp4")
          assert.equal(
            info.streams.find((s) => s.codec_type === "video").height,
            360,
          );
        console.log(
          `검증 완료 ${format}: ${bytes.length} bytes, ${info.format.duration}초`,
        );
      }
      assert.equal((await fetch(base + "/api/jobs/missing/file")).status, 404);
    } finally {
      child.kill();
      await new Promise((r) => setTimeout(r, 500));
      await rm(".data/test-output", { recursive: true, force: true });
    }
  },
);
