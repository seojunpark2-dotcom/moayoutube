import { randomBytes, timingSafeEqual } from "node:crypto";
import { isAllowedWebOrigin } from "./web-origins.mjs";
export const LOCAL_PORT = 47831;
export function localAccess({ port = LOCAL_PORT, now = Date.now } = {}) {
  const secret = randomBytes(32).toString("hex"),
    tickets = new Map();
  const localOrigins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  const allowed = (origin) =>
    typeof origin === "string" &&
    (localOrigins.includes(origin) || isAllowedWebOrigin(origin));
  function middleware(req, res, next) {
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host))
      return res
        .status(403)
        .json({ error: "로컬 주소로만 연결할 수 있습니다." });
    const origin = req.headers.origin;
    if (origin && !allowed(origin))
      return res.status(403).json({ error: "허용되지 않은 사이트입니다." });
    if (origin) {
      res.set("Access-Control-Allow-Origin", origin);
      res.vary("Origin");
      res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type, X-Moadrop-Token");
      res.set("Access-Control-Allow-Private-Network", "true");
    }
    if (req.method === "OPTIONS")
      return origin && allowed(origin)
        ? res.sendStatus(204)
        : res.sendStatus(403);
    if (req.path === "/health" && req.method === "GET") return next();
    if (req.path === "/local/session" && req.method === "GET") {
      if (!allowed(origin) && req.headers["sec-fetch-site"] !== "same-origin")
        return res
          .status(403)
          .json({ error: "로컬 화면이나 승인된 사이트에서 연결해 주세요." });
      res.set("Cache-Control", "no-store");
      return res.json({ token: secret });
    }
    if (
      req.method === "GET" &&
      /^\/jobs\/[a-f0-9-]{36}\/file$/.test(req.path)
    ) {
      const ticket = tickets.get(req.query.ticket);
      if (ticket && ticket.path === req.path && ticket.expires > now()) {
        tickets.delete(req.query.ticket);
        return next();
      }
    }
    const supplied = req.headers["x-moadrop-token"];
    if (
      typeof supplied !== "string" ||
      !/^[a-f0-9]{64}$/.test(supplied) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))
    )
      return res
        .status(401)
        .json({ error: "로컬 프로그램에 먼저 연결해 주세요." });
    next();
  }
  function issue(token) {
    for (const [key, t] of tickets) if (t.expires <= now()) tickets.delete(key);
    if (tickets.size >= 100)
      throw Error("다운로드 연결이 많습니다. 잠시 후 다시 시도해 주세요.");
    const ticket = randomBytes(24).toString("hex");
    tickets.set(ticket, {
      path: `/jobs/${token}/file`,
      expires: now() + 120000,
    });
    return ticket;
  }
  return { middleware, issue };
}
