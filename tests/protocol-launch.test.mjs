import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
test(
  "Windows 실행 연결은 고정 open URI 외의 입력을 거절함",
  { skip: process.platform !== "win32" },
  () => {
    const executable = path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "cscript.exe",
    );
    for (const args of [
      [],
      ["moadrop://open?url=https://example.com"],
      ["moadrop://open/other"],
      ["moadrop://open", "--eval"],
      ['moadrop://open" & calc.exe'],
      ["https://example.com"],
    ]) {
      const result = spawnSync(
        executable,
        [
          "//B",
          "//Nologo",
          path.resolve("scripts/protocol-launch.vbs"),
          ...args,
        ],
        { windowsHide: true },
      );
      assert.equal(result.status, 2, JSON.stringify(args));
    }
  },
);
