// Classify subprocess failures without returning stderr, signed URLs or command arguments.
export function youtubeFailure(error) {
  const stderr = String(error.stderr || "").toLowerCase();
  let code, message;
  if (error.killed) {
    code = "YOUTUBE_TIMEOUT";
    message =
      "YouTube 분석 제한 시간(45초)을 초과했습니다. 잠시 후 다시 시도해 주세요.";
  } else if (
    /no module named|cannot find module|unsupported javascript runtime|no supported javascript runtime/.test(
      stderr,
    ) ||
    error.code === "ENOENT"
  ) {
    code = "YOUTUBE_RUNTIME_MISSING";
    message =
      "변환 서버의 Python·YouTube 처리 도구 또는 JavaScript 실행 환경을 확인해야 합니다.";
  } else if (
    /confirm.{0,40}(not a bot|you.re not a bot)|sign in to confirm you.re not|bot detection/.test(
      stderr,
    )
  ) {
    code = "YOUTUBE_BOT_CHECK";
    message =
      "YouTube가 이 변환 서버에 봇 확인을 요구해 영상 파일 제공을 거절했습니다. 영상 정보는 조회할 수 있지만 현재 서버에서는 다운로드할 수 없습니다.";
  } else if (
    /private video|members.only|join this channel|login required|sign in|log in|confirm your age|age.restricted/.test(
      stderr,
    )
  ) {
    code = "YOUTUBE_AUTH_REQUIRED";
    message =
      "이 영상은 로그인·연령 확인 또는 별도 접근 권한이 필요해 서버에서 다운로드할 수 없습니다.";
  } else if (
    /not available in your country|geo.restrict|blocked.{0,40}country/.test(
      stderr,
    )
  ) {
    code = "YOUTUBE_REGION_BLOCKED";
    message = "이 영상은 변환 서버가 위치한 지역에서 제공되지 않습니다.";
  } else if (/http error 429|too many requests/.test(stderr)) {
    code = "YOUTUBE_RATE_LIMIT";
    message =
      "YouTube가 변환 서버의 요청을 일시적으로 제한했습니다(429). 잠시 후 다시 시도해 주세요.";
  } else if (/http error 403|forbidden/.test(stderr)) {
    code = "YOUTUBE_ACCESS_DENIED";
    message =
      "YouTube가 변환 서버의 영상 접근을 거절했습니다(403). 현재 서버에서는 이 파일을 받을 수 없습니다.";
  } else if (
    /nsig extraction failed|signature extraction failed|challenge solving failed|n challenge solving failed/.test(
      stderr,
    )
  ) {
    code = "YOUTUBE_EXTRACTOR_ERROR";
    message =
      "YouTube 처리 도구가 현재 영상 형식을 분석하지 못했습니다. 도구와 실행 환경의 호환성을 확인해야 합니다.";
  } else if (
    /video unavailable|video has been removed|video has been deleted|not available/.test(
      stderr,
    )
  ) {
    code = "YOUTUBE_UNAVAILABLE";
    message = "삭제되었거나 현재 제공되지 않는 YouTube 영상입니다.";
  } else if (error.signal === "SIGKILL") {
    code = "YOUTUBE_PROCESS_KILLED";
    message =
      "영상 분석 프로세스가 서버에서 강제 종료됐습니다. Render의 메모리 사용량과 실행 로그를 확인해야 합니다.";
  } else if (stderr) {
    code = "YOUTUBE_EXTRACTION_FAILED";
    message =
      "변환 서버에서 YouTube 영상 파일 정보를 가져오지 못했습니다. 서버 연결 또는 영상 제공 상태를 확인해야 합니다.";
  } else return error;
  return Object.assign(new Error(message), { code });
}
