import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";

test(
  "실제 API 재시작 후 완료 파일 복원 → 원본 서버 없이 분석·동일 바이트 다운로드",
  { timeout: 30000 },
  async () => {
    const namespace = randomUUID(),
      root = path.resolve(".data/test-jobs-" + namespace),
      base = "http://127.0.0.1:4118";
    let child;
    async function start() {
      child = spawn(process.execPath, ["server/index.mjs"], {
        windowsHide: true,
        stdio: "pipe",
        env: {
          ...process.env,
          PORT: "4118",
          API_HOST: "127.0.0.1",
          NODE_ENV: "test",
          TEST_JOB_NAMESPACE: namespace,
          YOUTUBE_PROVIDER: "cobalt",
          COBALT_URL: "http://127.0.0.1:9000",
        },
      });
      child.stdout.resume();
      child.stderr.resume();
      for (let n = 0; n < 70; n++) {
        try {
          if ((await fetch(base + "/api/health")).ok) return;
        } catch {}
        await new Promise((r) => setTimeout(r, 100));
      }
      throw Error("server not ready");
    }
    async function stop() {
      if (!child) return;
      child.kill();
      await new Promise((r) => child.once("exit", r));
      child = null;
    }
    const post = (route, body) =>
      fetch(base + route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
    try {
      await start();
      const created = await (
        await post("/api/jobs", { id: "studio", format: "mp3", bitrate: 128 })
      ).json();
      let state;
      for (let n = 0; n < 100; n++) {
        state = await fetch(base + "/api/jobs/" + created.token).then((r) =>
          r.json(),
        );
        if (state.state !== "processing") break;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.equal(state.state, "done", JSON.stringify(state));
      const first = Buffer.from(
        await fetch(base + `/api/jobs/${created.token}/file`).then((r) =>
          r.arrayBuffer(),
        ),
      );
      const manifestFile = path.join(root, created.token, "manifest.json");
      let manifest;
      for (let n = 0; n < 30; n++) {
        try {
          manifest = JSON.parse(await readFile(manifestFile, "utf8"));
          break;
        } catch {}
        await new Promise((r) => setTimeout(r, 30));
      }
      assert.ok(manifest);
      await stop();
      // A valid completed-file fixture with a YouTube cache identity. No external source is contacted.
      manifest.key = JSON.stringify(["yt:abcdefghijk", "mp3", null, 128]);
      await writeFile(manifestFile, JSON.stringify(manifest));
      await start();
      const analysis = await (
        await post("/api/analyze", {
          url: "https://www.youtube.com/watch?v=abcdefghijk",
          format: "mp3",
          bitrate: 128,
        })
      ).json();
      assert.equal(analysis.cached, true);
      assert.equal(analysis.downloadable, true);
      const repeated = await (
        await post("/api/jobs", {
          id: "yt:abcdefghijk",
          format: "mp3",
          bitrate: 128,
        })
      ).json();
      assert.equal(repeated.cached, true);
      assert.equal(repeated.token, created.token);
      const second = Buffer.from(
        await fetch(base + `/api/jobs/${repeated.token}/file`).then((r) =>
          r.arrayBuffer(),
        ),
      );
      assert.deepEqual(second, first);
    } finally {
      await stop();
      await rm(root, { recursive: true, force: true });
    }
  },
);
