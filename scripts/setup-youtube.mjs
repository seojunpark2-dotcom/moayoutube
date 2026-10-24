import { spawnSync } from "node:child_process";
const result = spawnSync(
  process.env.PYTHON_BIN || "python",
  [
    "-m",
    "pip",
    "install",
    "--upgrade",
    "--target",
    ".tools/python",
    "-r",
    "requirements-youtube.txt",
    "--disable-pip-version-check",
  ],
  { stdio: "inherit", windowsHide: true },
);
if (result.error)
  console.error(
    "Python 3.10 이상과 pip가 필요합니다. PYTHON_BIN으로 Python 실행 파일을 지정할 수 있습니다.",
  );
process.exit(result.status ?? 1);
