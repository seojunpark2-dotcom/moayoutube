// Public deployment identifiers for this project, verified in the Vercel project settings.
// Change both identifiers when deploying a fork under another Vercel account.
const project = "moayoutube";
const team = "seojunpark2";
const projectDeployment = new RegExp(
  `^${project}-(?:[a-z0-9]{9}|git-[a-z0-9-]+)-${team}\\.vercel\\.app$`,
);

function configuredOrigin(value) {
  try {
    const url = new URL(value.trim());
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isAllowedWebOrigin(value, env = process.env) {
  // Non-browser clients do not send Origin; preserve the existing public API behavior.
  if (value === undefined) return true;
  if (typeof value !== "string") return false;
  const origin = configuredOrigin(value);
  // Browser Origin must be an origin, not a URL path or an opaque/null origin.
  if (!origin || value !== origin) return false;
  const configured = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    `https://${project}.vercel.app`,
    `https://${project}-${team}.vercel.app`,
    env.WEB_ORIGIN || "",
    ...(env.WEB_ORIGINS || "").split(","),
  ]
    .map(configuredOrigin)
    .filter(Boolean);
  if (configured.includes(origin)) return true;
  const url = new URL(origin);
  return (
    url.protocol === "https:" &&
    !url.port &&
    projectDeployment.test(url.hostname)
  );
}
