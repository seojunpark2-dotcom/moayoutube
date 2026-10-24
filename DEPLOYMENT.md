# Vercel + 변환 서버 배포

이 저장소에는 웹 화면과 실제 변환 서버 코드가 모두 포함되어 있습니다. **Vercel에 저장소를 연결하는 것만으로 다운로드 서버까지 실행되지는 않습니다.**

## 1. 변환 서버를 먼저 실행

Node.js 24, Python 3.10 이상, 인터넷 연결, 최소 10GiB 여유 디스크가 있는 Linux x64 VM 또는 컨테이너 서버를 사용합니다. 단일 인스턴스로 운영하며 자동 수면·요청 중 프로세스 종료를 사용하지 마세요. FFmpeg는 npm 의존성에 포함됩니다.

Docker를 사용할 경우 저장소 루트에서:

```sh
docker build -f Dockerfile.api -t moadrop-api .
docker volume create moadrop-data
docker run -d --name moadrop-api --restart unless-stopped \
  -p 127.0.0.1:4000:4000 \
  -e WEB_ORIGIN=https://your-project.vercel.app \
  -v moadrop-data:/app/.data moadrop-api
```

`WEB_ORIGIN`을 사용할 웹사이트 원점으로 변경하세요. 서버에 HTTPS 도메인(예: `https://api.example.com`)과 리버스 프록시를 연결하여 포트 4000으로 전달합니다. 큰 파일 다운로드를 프록시가 메모리에 버퍼링하지 않도록 하고 최소 120분 연결 시간·최소 2GiB 응답을 허용하세요. `/api/health`가 `{"ok":true,"active":0}`을 반환하는지 확인합니다.

Docker 없이 실행하려면 `npm ci`, `npm run setup:youtube`, `npm run setup`을 실행하고 `API_HOST=0.0.0.0`, `WEB_ORIGIN` 및 필요 시 `API_PORT`를 호스팅 환경에 지정한 뒤 `node server/index.mjs`를 프로세스 관리자로 실행하세요. Windows의 로컬 개발은 기존 `npm run dev`를 사용합니다.

임시 다운로드는 `.data/jobs`에 생성됩니다. 실행 사용자가 쓰기 가능해야 하며 컨테이너는 기본 `node` 사용자로 실행합니다. 작업은 메모리에 보관하므로 재시작·배포 시 진행 작업은 중단됩니다. 영속 볼륨은 등록 소스를 보존하며, 이전 작업 파일은 시작 시 정리됩니다. 다중 복제 인스턴스를 사용하지 마세요.

## 2. Vercel에 GitHub 저장소 연결

1. Vercel에서 Add New → Project → 이 GitHub 저장소를 Import 합니다. 비공개 저장소 접근 권한을 허용하세요.
2. Root Directory는 저장소 루트, Framework는 Next.js, Node.js 버전은 24.x로 지정합니다.
3. 환경 변수 **`API_ORIGIN=https://api.example.com`**을 실제 변환 서버 주소로 지정합니다. 경로 `/api`, 사용자명·비밀번호, 쿼리는 넣지 않습니다. 사용하는 Production/Preview 환경 각각에 지정합니다.
4. Deploy 합니다. `vercel.json`이 설치·빌드 명령을 지정합니다. 프런트엔드 설치는 `--ignore-scripts`로 FFmpeg 바이너리 설치를 생략합니다. 백엔드 설치에는 이 옵션을 사용하지 마세요.
5. 실제 웹 도메인이 정해지면 변환 서버의 `WEB_ORIGIN`을 일치시키고 API를 재시작합니다. Preview에서 작업 요청을 시험하려면 그 Preview 원점을 `WEB_ORIGIN`으로 설정한 별도 API 인스턴스를 사용하세요.

프런트엔드는 분석·작업 생성·진행률 요청을 `/api` rewrite로 전달합니다. 완성 파일은 브라우저에서 변환 서버로 **직접 다운로드**하여 대용량 파일의 Vercel 경유 전송을 피합니다. 공개 파일 원점은 기본적으로 `API_ORIGIN`에서 빌드 시 생성되며, 필요한 경우 `NEXT_PUBLIC_DOWNLOAD_ORIGIN`으로 별도 지정할 수 있습니다. 이 주소는 브라우저에 노출되므로 비밀을 넣지 마세요. 원점 변경 후에는 Vercel을 다시 빌드해야 합니다. 일반 다운로드는 서버의 `Content-Disposition: attachment` 파일명을 사용하며 CORS fetch가 필요하지 않습니다.

`API_ORIGIN`이 없는 Vercel 빌드는 명확한 오류로 중단됩니다. 로컬 환경은 기존 localhost 연결을 사용합니다. `.env.example`은 설명용이며 실제 값은 Vercel/백엔드 호스팅의 환경 변수 설정에 입력하세요.

## 3. 배포 후 확인

샘플 분석→MP4·MP3 저장, 실제 공개 영상의 분석→작업 진행률→전체 파일 수신을 확인합니다. 3시간 영상은 파일 크기·원본 서버 속도 영향을 받으며 현재 원본 합계와 결과 파일은 각각 최대 2GiB입니다. 인증·DRM·플랫폼 접근 제한은 우회하지 않습니다. 서버 IP에서 원본이 접근을 거절하면 사용자에게 오류를 안내합니다.

이 업로드 준비 과정에서는 로컬 테스트·빌드만 수행했습니다. Docker가 설치되지 않은 환경이므로 Docker 이미지 빌드와 실제 클라우드 배포는 아직 검증하지 않았습니다. 호스팅 비용과 도메인·TLS는 선택한 서버 서비스에 따라 별도로 설정해야 합니다.

공식 제한 참고: [Vercel 외부 프록시 제한](https://vercel.com/docs/limits#proxied-request-timeout), [Functions 크기·실행 시간 제한](https://vercel.com/docs/functions/limitations).
