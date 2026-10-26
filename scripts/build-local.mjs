import { spawnSync } from "node:child_process";
const r = spawnSync(
  process.execPath,
  ["node_modules/next/dist/bin/next", "build"],
  {
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, LOCAL_EXPORT: "1", NEXT_TELEMETRY_DISABLED: "1" },
  },
);
process.exit(r.status || (r.error ? 1 : 0));
