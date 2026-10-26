# 모아드롭 로컬 실행 · Windows x64

## 일반 사용자

1. [실행 ZIP 다운로드](https://github.com/seojunpark2-dotcom/moayoutube-local/releases/latest/download/moayoutube-local-windows-x64.zip).
2. ZIP 전체를 원하는 폴더에 압축 해제합니다. ZIP 내부에서 바로 실행하지 마세요.
3. **모아드롭 실행.cmd**를 더블클릭합니다. Node.js·Python·FFmpeg를 따로 설치할 필요가 없습니다.
4. 자동으로 열리는 `http://127.0.0.1:47831/`에서 영상 URL을 입력합니다.
5. MP3 또는 MP4를 선택해 확인·다운로드합니다. 종료하려면 화면의 **프로그램 종료** 또는 실행 창의 Ctrl+C를 사용합니다.

[공개 사이트](https://moayoutube.vercel.app)에서도 프로그램을 켠 상태에서 **내 PC 연결하기**를 누르면 사용할 수 있습니다. Chrome·Edge가 로컬 네트워크 접근을 요청하면 허용해야 합니다. 연결이 차단되면 프로그램이 직접 연 로컬 화면을 사용하세요. 브라우저 보안 기능을 끌 필요는 없습니다.

각 사용자의 PC가 직접 원본을 받고 변환합니다. 운영자 PC나 Render 서버를 거치지 않습니다. 프로그램 실행 중에는 본인 PC의 CPU·저장 공간·인터넷을 사용합니다. 모바일·macOS 실행 파일은 현재 제공하지 않습니다. 사용자 네트워크에서도 YouTube가 접근을 거절하면 실패할 수 있으며 인증·DRM·접근 제한을 우회하지 않습니다.

프로그램 폴더와 작업 저장용으로 충분한 디스크 공간을 확보하세요(10GiB 이상 권장). 완료 파일은 이 폴더의 `.data/jobs`에 최대 24시간·2GiB 예산으로 보관합니다. 이 폴더를 다른 사람에게 보낼 때에는 사용자 작업 파일을 포함하지 마세요. 공식 배포 ZIP에는 직접 생성한 샘플만 들어 있습니다.

## 실행 구조와 연결 보호

- 서버는 `127.0.0.1:47831`에만 바인딩합니다. LAN 전체나 인터넷에 포트를 열지 않습니다.
- 웹 화면과 API가 같은 로컬 주소에서 제공되며 Vercel 화면도 승인된 출처로 연결할 수 있습니다.
- Host·Origin 검사, 실행 때마다 새로 생성되는 세션 토큰, 2분 유효 일회용 파일 다운로드 표를 사용합니다. 세션 토큰은 브라우저 메모리에만 보관합니다.
- 연결 정보·썸네일·분석·작업 요청은 로컬 API로 전송합니다. Vercel에서 Render로 전달하는 API rewrite는 제거했습니다.
- 계정 쿠키·브라우저 로그인 정보·사용자의 Python 설정을 읽지 않습니다. 원본은 yt-dlp, 변환은 별도 FFmpeg 작업 프로세스가 담당합니다.

## 개발과 패키징

```powershell
npm ci
npm run setup:youtube
npm run setup
npm run dev
```

개발 화면은 `http://localhost:3000`, 연결 프로그램은 `http://127.0.0.1:47831`입니다. 개발 화면에서 연결 버튼을 누릅니다. Python 실행 파일이 PATH에 없다면 실행 환경의 `PYTHON_BIN`을 지정할 수 있습니다. 이 작업 환경은 `.tools/python-bin.txt`의 로컬 경로를 사용하며 해당 파일은 배포에 포함하지 않습니다.

```powershell
npm run build:local
npm run package:windows
node scripts/check-package.mjs
```

Windows x64에서 실행합니다. 빌드 결과는 `.next-local`, 패키지는 `.data/dist`에 생성합니다. 패키징은 공식 Node 릴리스 체크섬 및 Python 3.14.10 공식 SHA-256을 검증합니다. 사용자 작업·URL 전체·인증 정보·`.env`·`.git`·개인 Python 경로는 복사하지 않습니다. `scripts/check-package.mjs`는 전역 PATH에서 Node·Python을 제외하고 내장 실행 파일만 사용해 샘플 MP3를 검증합니다.

Node·Python·yt-dlp·npm 의존성의 라이선스와 FFmpeg GPL 고지·정확한 소스 위치는 실행 패키지의 `LICENSES`, Python의 `LICENSE.txt`, 각 의존성 디렉터리에 포함됩니다. 제3자 실행 파일은 해당 프로젝트의 라이선스를 따릅니다.

## 웹 배포

기존 Next.js 프로젝트를 Vercel에 배포합니다. `API_ORIGIN` 및 `NEXT_PUBLIC_DOWNLOAD_ORIGIN`은 더 이상 사용하지 않습니다. 실행 파일 링크를 별도로 바꾸려면 `COMPANION_DOWNLOAD_URL`에 공개 HTTPS ZIP 주소를 지정하고 재배포합니다. 기본값은 위의 공개 GitHub Releases 주소입니다.

Render 변환 서버는 현재 웹 화면에서 사용하지 않습니다. 기존 Render 서비스는 계정에서 중지해도 로컬 다운로드에 영향을 주지 않습니다. 이 작업에서 사용자 서비스나 계정은 삭제하지 않습니다.

## v2.0.0 검증 기록 (2026-10-26)

- 자동 테스트 43개 및 TypeScript 검사 통과, 로컬 정적 빌드 성공.
- 전역 Node·Python·FFmpeg 경로를 제거하고 최종 ZIP 내장 런타임만으로 기동·샘플 MP3 변환·파일 저장 확인.
- 1440·675·390·320px에서 썸네일, 실제 샘플 MP3 저장, 다크모드, 가로 넘침 없음 확인. 모바일 너비 UI 검사이며 모바일 프로그램 지원을 뜻하지 않습니다.
- 로컬 네트워크에서 테스트 YouTube 영상의 360p MP4(52,532,838바이트), MP3(11,667,374바이트)를 브라우저로 저장하고 FFprobe로 약 729초 길이 확인. 원본 접근 상태에 따라 결과가 달라질 수 있습니다.
