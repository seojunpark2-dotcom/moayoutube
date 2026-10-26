import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { request } from "node:http";
import { localAccess } from "../server/local-access.mjs";
test("로컬 API: 출처·Host·세션 보호 및 일회용 다운로드 표", async () => {
  const port = 4119,
    origin = "https://moayoutube.vercel.app",
    id = "12345678-1234-1234-1234-123456789abc";
  let clock = Date.now();
  const access = localAccess({ port, now: () => clock }),
    app = express();
  app.use("/api", access.middleware);
  app.get("/api/health", (_, res) => res.json({ ok: true }));
  app.get("/api/private", (_, res) => res.json({ ok: true }));
  app.post("/api/ticket", (_, res) => res.json({ ticket: access.issue(id) }));
  app.get(`/api/jobs/${id}/file`, (_, res) => res.send("file"));
  const server = app.listen(port, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.equal((await fetch(base + "/api/health")).status, 200);
    assert.equal((await fetch(base + "/api/local/session")).status, 403);
    assert.equal(
      (
        await fetch(base + "/api/local/session", {
          headers: { Origin: "https://evil.example" },
        })
      ).status,
      403,
    );
    const r = await fetch(base + "/api/local/session", {
      headers: { Origin: origin },
    });
    const { token } = await r.json();
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.equal(r.headers.get("access-control-allow-origin"), origin);
    const preflight = await fetch(base + "/api/private", {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Headers": "x-moadrop-token",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(
      preflight.headers.get("access-control-allow-private-network"),
      "true",
    );
    assert.equal((await fetch(base + "/api/private")).status, 401);
    assert.equal(
      (
        await fetch(base + "/api/private", {
          headers: { "X-Moadrop-Token": "x".repeat(64) },
        })
      ).status,
      401,
    );
    const rebound = await new Promise((resolve) => {
      const req = request(
        base + "/api/private",
        { headers: { Host: "evil.example", "X-Moadrop-Token": token } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.end();
    });
    assert.equal(rebound, 403);
    assert.equal(
      (
        await fetch(base + "/api/private", {
          headers: { "X-Moadrop-Token": token },
        })
      ).status,
      200,
    );
    const headers = { Origin: origin, "X-Moadrop-Token": token };
    const { ticket } = await fetch(base + "/api/ticket", {
      method: "POST",
      headers,
    }).then((r) => r.json());
    const file = `${base}/api/jobs/${id}/file?ticket=${ticket}`;
    assert.equal((await fetch(file)).status, 200);
    assert.equal((await fetch(file)).status, 401);
    const expired = await fetch(base + "/api/ticket", {
      method: "POST",
      headers,
    }).then((r) => r.json());
    clock += 121000;
    assert.equal(
      (await fetch(`${base}/api/jobs/${id}/file?ticket=${expired.ticket}`))
        .status,
      401,
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
});
