import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
if (process.platform !== "win32") throw Error("Windows에서 실행하세요.");
const root = fileURLToPath(new URL("../", import.meta.url));
const base = "HKCU\\Software\\Classes\\moadrop";
const runner = path.join(root, "scripts", "protocol-launch.vbs");
const system = path.join(process.env.SystemRoot || "C:\\Windows", "System32");
const reg = (args) =>
  execFileSync(path.join(system, "reg.exe"), args, {
    windowsHide: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
const command = `"${path.join(system, "wscript.exe")}" //B //Nologo "${runner}" "%1"`;
const commandKey = base + "\\shell\\open\\command";
function readCurrent() {
  const code =
    "[Console]::OutputEncoding=[Text.UTF8Encoding]::new();$ErrorActionPreference='Stop';(Get-Item -LiteralPath 'Registry::HKEY_CURRENT_USER\\Software\\Classes\\moadrop\\shell\\open\\command').GetValue('')";
  try {
    return execFileSync(
      path.join(system, "WindowsPowerShell", "v1.0", "powershell.exe"),
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(code, "utf16le").toString("base64"),
      ],
      {
        windowsHide: true,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
  } catch {
    return "";
  }
}
const current = readCurrent();
if (process.argv.includes("--remove")) {
  if (current !== command)
    throw Error(
      "현재 폴더에 등록된 연결이 없습니다. 다른 폴더의 연결은 변경하지 않습니다.",
    );
  reg(["delete", base, "/f"]);
  console.log(
    "사이트 실행 연결을 해제했습니다. 프로그램 파일은 삭제하지 않았습니다.",
  );
} else {
  if (
    !existsSync(path.join(root, "runtime", "node.exe")) ||
    !existsSync(runner)
  )
    throw Error("ZIP 전체를 압축 해제한 폴더에서 등록하세요.");
  if (current && !current.includes("protocol-launch.vbs"))
    throw Error(
      "moadrop 연결을 다른 프로그램이 사용 중입니다. 기존 연결은 변경하지 않았습니다.",
    );
  reg([
    "add",
    base,
    "/ve",
    "/t",
    "REG_SZ",
    "/d",
    "URL:Moadrop Local Companion",
    "/f",
  ]);
  reg(["add", base, "/v", "URL Protocol", "/t", "REG_SZ", "/d", "", "/f"]);
  reg(["add", commandKey, "/ve", "/t", "REG_SZ", "/d", command, "/f"]);
  if (readCurrent() !== command) throw Error("실행 연결 확인에 실패했습니다.");
  console.log(
    "사이트 실행 연결을 등록했습니다. 사이트의 링크 확인 버튼에서 프로그램을 열 수 있습니다.",
  );
  console.log(
    "이 폴더를 이동하거나 삭제하면 다시 등록해야 합니다. 해제는 '사이트 연결 해제.cmd'를 실행하세요.",
  );
}
