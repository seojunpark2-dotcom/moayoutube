import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { probeFile } from "../server/library.mjs";

test(
  "Cobalt 응답 → 실제 파일 전송 → FFmpeg MP4·MP3·M4A·OPUS 생성",
  { timeout: 45000 },
  async () => {
    const bytes = await readFile(".data/library/studio.mp4");
    const id = "aqz-KE-bpKQ",
      dir = ".data/cobalt-worker-test";
    const server = createServer(async (req, res) => {
      if (req.method === "POST" && req.url === "/") {
        let text = "";
        for await (const c of req) text += c;
        const body = JSON.parse(text),
          audio = body.downloadMode === "audio";
        assert.equal(body.localProcessing, "forced");
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            status: "local-processing",
            service: "youtube",
            type: audio ? "audio" : "merge",
            tunnel: Array(audio ? 1 : 2).fill(
              "http://127.0.0.1:9000/tunnel?id=test",
            ),
            output: {
              filename: `youtube_${id}_${audio ? "audio.m4a" : "1280x720_h264.mp4"}`,
            },
          }),
        );
      } else {
        res.writeHead(200, {
          "Content-Type": "video/mp4",
          "Content-Length": bytes.length,
        });
        res.end(bytes);
      }
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(9000, "127.0.0.1", resolve);
    });
    await mkdir(dir, { recursive: true });
    try {
      for (const format of ["mp4", "mp3", "m4a", "opus"]) {
        const output = `${dir}/result.${format}`;
        const child = spawn(
          process.execPath,
          [
            "server/worker.mjs",
            JSON.stringify({
              cobalt: { id },
              output,
              format,
              quality: 720,
              bitrate: 192,
            }),
          ],
          {
            windowsHide: true,
            env: { ...process.env, COBALT_URL: "http://127.0.0.1:9000" },
          },
        );
        let stdout = "",
          stderr = "";
        child.stdout.on("data", (c) => (stdout += c));
        child.stderr.on("data", (c) => (stderr += c));
        const code = await new Promise((resolve, reject) => {
          child.on("error", reject);
          child.on("close", resolve);
        });
        assert.equal(code, 0, stdout + stderr);
        const media = await probeFile(output);
        assert.ok(Math.abs(+media.format.duration - 8) < 1);
        assert.ok(media.streams.some((s) => s.codec_type === "audio"));
        if (format === "mp4")
          assert.equal(
            media.streams.find((s) => s.codec_type === "video").height,
            720,
          );
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await rm(dir, { recursive: true, force: true });
    }
  },
);
