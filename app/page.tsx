"use client";
import { useEffect, useRef, useState } from "react";
import { POLL_TIMEOUT_MS } from "../server/limits.mjs";
import { MP3_BITRATES, VIDEO_QUALITIES } from "../server/output-options.mjs";
import {
  connectLocal,
  localAPI as api,
  localFetch,
  localDownload,
} from "../lib/local-client";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  AudioLines,
  Check,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Film,
  Headphones,
  Link2,
  LoaderCircle,
  Moon,
  Play,
  ShieldCheck,
  Sun,
  X,
} from "lucide-react";
type Media = {
  id: string;
  title: string;
  author: string;
  thumbnail: string;
  duration: number | null;
  qualities: number[];
  downloadable: boolean;
  convertible: boolean;
  permission: string;
  source: string;
  audioBitrate?: number | null;
  size?: number;
  height?: number;
  youtube?: boolean;
  nativeAudioFormat?: "m4a" | "opus" | null;
};
const SAMPLE = "https://sample.moadrop.local/studio-loop.mp4";
function durationText(value: number, clock = false) {
  const n = Math.max(0, Math.round(value)),
    hours = Math.floor(n / 3600),
    minutes = Math.floor((n % 3600) / 60),
    seconds = n % 60;
  return clock
    ? `${hours ? hours + ":" : ""}${hours ? String(minutes).padStart(2, "0") : minutes}:${String(seconds).padStart(2, "0")}`
    : hours
      ? `${hours}시간 ${minutes}분 ${seconds}초`
      : minutes
        ? `${minutes}분 ${seconds}초`
        : `${seconds}초`;
}
export default function Home() {
  const [connected, setConnected] = useState(false),
    [connecting, setConnecting] = useState(false);
  const [setup, setSetup] = useState(false),
    [setupExpired, setSetupExpired] = useState(false);
  const [launchAttempt, setLaunchAttempt] = useState(0);
  const resumeAfterSetup = useRef<(() => void) | null>(null);
  const [dark, setDark] = useState(false),
    [url, setUrl] = useState(""),
    [media, setMedia] = useState<Media | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [tab, setTab] = useState<"video" | "audio">("audio"),
    [format, setFormat] = useState("mp3"),
    [quality, setQuality] = useState(720),
    [bitrate, setBitrate] = useState(128),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [file, setFile] = useState(""),
    [completedToken, setCompletedToken] = useState(""),
    [message, setMessage] = useState("");
  const [transferStats, setTransferStats] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    result = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      setDark(localStorage.getItem("moadrop-theme") === "dark");
    } catch {
      /* 저장소가 차단되어도 기본 테마로 사용할 수 있습니다. */
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  async function connect() {
    setConnecting(true);
    setError("");
    try {
      await connectLocal();
      setConnected(true);
      setSetup(false);
      const resume = resumeAfterSetup.current;
      resumeAfterSetup.current = null;
      resume?.();
    } catch {
      setConnected(false);
      if (!setup) setSetupExpired(false);
      setSetup(true);
    } finally {
      setConnecting(false);
    }
  }
  useEffect(() => {
    if (!setup) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout>;
    const deadline = Date.now() + 180000;
    async function detect() {
      try {
        await connectLocal();
        if (cancelled) return;
        setConnected(true);
        setSetup(false);
        setError("");
        const resume = resumeAfterSetup.current;
        resumeAfterSetup.current = null;
        resume?.();
      } catch {
        if (cancelled) return;
        if (Date.now() >= deadline) setSetupExpired(true);
        else retry = setTimeout(detect, 2000);
      }
    }
    retry = setTimeout(detect, 1500);
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, [setup, launchAttempt]);
  useEffect(() => {
    if (
      ["127.0.0.1", "localhost"].includes(window.location.hostname) &&
      window.location.port === "47831"
    ) {
      connectLocal()
        .then(() => setConnected(true))
        .catch(() => {});
    }
  }, []);
  useEffect(
    () => () => {
      if (media?.thumbnail.startsWith("blob:"))
        URL.revokeObjectURL(media.thumbnail);
    },
    [media],
  );
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  function toggle() {
    setDark(!dark);
    try {
      localStorage.setItem("moadrop-theme", dark ? "light" : "dark");
    } catch {
      /* 테마 선택의 영구 저장은 선택 사항입니다. */
    }
  }
  function launchLocal() {
    // A fixed URI only: never send a video URL, command, or credentials to Windows.
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.title = "모아드롭 프로그램 실행 요청";
    frame.src = "moadrop://open";
    document.body.appendChild(frame);
    setTimeout(() => frame.remove(), 30000);
    setSetupExpired(false);
    setLaunchAttempt((n) => n + 1);
  }
  function analyzeFromClick(value = url, mode = tab) {
    if (busy || loading || connecting) return;
    try {
      if (!connected && new URL(value.trim()).protocol === "https:")
        launchLocal();
    } catch {
      /* Invalid URLs are explained by analyze(). */
    }
    void analyze(value, mode);
  }
  async function analyze(value = url, mode = tab, connectionReady = false) {
    if (busy || loading) return;
    setLoading(true);
    setError("");
    setMedia(null);
    setFile("");
    setCompletedToken("");
    setMessage("");
    try {
      let u: URL;
      try {
        u = new URL(value.trim());
      } catch {
        throw Error("올바른 영상 URL을 입력해 주세요.");
      }
      if (u.protocol !== "https:") throw Error("HTTPS URL을 입력해 주세요.");
      if (!connectionReady) {
        setConnecting(true);
        try {
          await connectLocal();
          setConnected(true);
          setSetup(false);
        } catch {
          if (connected) launchLocal();
          resumeAfterSetup.current = () => void analyze(value, mode, true);
          setSetupExpired(false);
          setSetup(true);
          return;
        } finally {
          setConnecting(false);
        }
      }
      const m = await api("/api/analyze", {
        url: value,
        format: mode === "video" ? "mp4" : "mp3",
        quality,
        bitrate,
      });
      if (m.thumbnail?.startsWith("/api/")) {
        const thumbnail = await localFetch(m.thumbnail);
        if (thumbnail.ok)
          m.thumbnail = URL.createObjectURL(await thumbnail.blob());
      }
      setMedia(m);
      setFormat((current) =>
        current === "original" && !m.nativeAudioFormat ? "mp3" : current,
      );
      setQuality(
        m.qualities.includes(quality) ? quality : m.qualities[0] || quality,
      );
      setTab(mode === "video" && m.qualities.length ? "video" : "audio");
      setTimeout(
        () =>
          result.current?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          }),
        100,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "올바른 URL을 입력해 주세요.");
    } finally {
      setLoading(false);
    }
  }
  async function paste() {
    try {
      setUrl(await navigator.clipboard.readText());
      setError("");
    } catch {
      setError(
        "클립보드 접근이 허용되지 않았습니다. 입력창에 직접 붙여넣어 주세요.",
      );
    }
  }
  async function download() {
    if (!media || busy) return;
    setBusy(true);
    setProgress(0);
    setTransferStats("");
    setError("");
    setFile("");
    setCompletedToken("");
    setMessage("변환을 준비하고 있습니다");
    try {
      const { token } = await api("/api/jobs", {
        id: media.id,
        format: tab === "video" ? "mp4" : format,
        quality,
        bitrate,
      });
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      const pollStarted = Date.now();
      async function poll() {
        try {
          if (Date.now() > deadline)
            throw Error("상태 확인 시간이 초과되었습니다. 다시 시도해 주세요.");
          const job = await api("/api/jobs/" + token);
          setProgress(job.progress);
          if (job.state === "error") throw Error(job.error);
          if (job.state === "done") {
            const link = await localDownload(token);
            setFile(link);
            setCompletedToken(token);
            setBusy(false);
            setMessage("파일 준비가 완료되었습니다");
            const a = document.createElement("a");
            a.href = link;
            a.download = "";
            document.body.appendChild(a);
            a.click();
            a.remove();
            return;
          }
          if (job.phase === "downloading") {
            setMessage("원본 파일을 내려받고 있습니다");
            if (job.received) {
              const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
              const speed =
                job.speed >= 1024 * 1024
                  ? `${mb(job.speed)} MB/초`
                  : `${Math.round((job.speed || 0) / 1024)} KB/초`;
              const eta =
                job.eta == null
                  ? ""
                  : ` · 약 ${job.eta >= 60 ? `${Math.floor(job.eta / 60)}분 ` : ""}${job.eta % 60}초 남음`;
              setTransferStats(
                `${mb(job.received)} MB${job.total ? ` / ${mb(job.total)} MB` : ""} · ${speed}${eta}`,
              );
            }
          } else {
            setTransferStats("");
            setMessage(
              job.phase === "converting"
                ? job.mode === "audio-copy"
                  ? "원본 음원을 빠르게 준비하고 있습니다"
                  : job.mode === "remux"
                    ? "영상과 음원을 빠르게 합치고 있습니다"
                    : "파일을 변환하고 있습니다"
                : "다운로드를 준비하고 있습니다",
            );
          }
          timer.current = setTimeout(
            poll,
            Date.now() - pollStarted < 4000 ? 250 : 800,
          );
        } catch (e) {
          setBusy(false);
          setMessage("");
          setError(e instanceof Error ? e.message : "변환에 실패했습니다.");
        }
      }
      await poll();
    } catch (e) {
      setBusy(false);
      setMessage("");
      setError(e instanceof Error ? e.message : "변환에 실패했습니다.");
    }
  }
  return (
    <>
      <header className="header">
        <a href="/" className="brand" aria-label="모아드롭 홈">
          <span className="brand-mark">
            <ArrowDownToLine size={21} />
          </span>
          모아드롭<span className="brand-en">moadrop</span>
        </a>
        <nav>
          <a href="#guide" className="guide-link">
            이용 안내 <ArrowRight size={14} />
          </a>
          <span className="nav-divider" />
          <button
            className="theme"
            onClick={toggle}
            aria-label={dark ? "라이트 모드로 전환" : "다크 모드로 전환"}
          >
            {dark ? <Sun size={19} /> : <Moon size={19} />}
          </button>
        </nav>
      </header>
      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <span /> 소장하고 싶은 순간을, 간편하게
            </div>
            <h1>
              영상도, 소리도.
              <br />
              <span className="accent-word">
                내게 맞는 형식으로.
                <svg
                  viewBox="0 0 480 16"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path d="M3 10 Q230 -5 477 9" />
                </svg>
              </span>
            </h1>
            <p className="intro">
              링크 하나로 시작하세요.
              <br className="mobile-break" /> 허용된 영상과 음원을
              <br className="desktop-break" /> 원하는 형식으로 가볍게 저장할 수
              있어요.
            </p>
            <div className="hero-pills">
              <span>
                <Check size={14} /> 회원가입 없이
              </span>
              <span>
                <Check size={14} /> 광고 없이
              </span>
              <span>
                <Check size={14} /> 필요한 기능만
              </span>
            </div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <span className="orbit-dot" />
            <div className="art-main">
              <div className="art-top">
                <span className="tiny-dot" /> 나의 순간을, 내 기기에.
                <span>↗</span>
              </div>
              <div className="film-stack">
                <div className="back-tile" />
                <div className="film-tile">
                  <Film size={55} strokeWidth={1.2} />
                  <span>영상</span>
                </div>
                <div className="sound-tile">
                  <AudioLines size={49} strokeWidth={1.5} />
                  <span>음원</span>
                </div>
              </div>
              <div className="art-bottom">
                <span>링크</span>
                <span className="dotted-line" />
                <span className="art-arrow">
                  <ArrowDown size={18} />
                </span>
                <span className="dotted-line" />
                <span>내 파일</span>
              </div>
            </div>
            <span className="float-tag">
              <CheckCircle2 size={15} /> 준비 완료
            </span>
          </div>
        </section>
        <section className="workspace" aria-label="영상 링크 분석">
          <div className="local-connection" role="status">
            <div>
              <strong>
                {connected
                  ? "내 PC에 연결됨"
                  : "링크를 입력하면 실행 환경을 확인합니다"}
              </strong>
              <p>
                {connected
                  ? "다운로드와 변환은 이 PC에서 처리합니다. 이 화면에서 바로 이용하세요."
                  : "실행 중인 프로그램은 자동으로 연결하고, 처음 이용할 때는 준비 방법을 안내합니다."}
              </p>
            </div>
            <div className="local-actions">
              {connected && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      await api("/api/local/shutdown", {});
                      setConnected(false);
                      setFile("");
                      setMessage("로컬 프로그램을 종료했습니다.");
                    } catch (err) {
                      setError(
                        err instanceof Error
                          ? err.message
                          : "종료에 실패했습니다.",
                      );
                    }
                  }}
                >
                  프로그램 종료
                </button>
              )}
              <button
                type="button"
                onClick={connect}
                disabled={connecting || busy}
              >
                {connecting
                  ? "연결 중…"
                  : connected
                    ? "연결 다시 확인"
                    : "내 PC 연결하기"}
              </button>
              <a
                href="http://127.0.0.1:47831/"
                target="_blank"
                rel="noopener noreferrer"
              >
                로컬 화면 열기
              </a>
              {process.env.NEXT_PUBLIC_COMPANION_DOWNLOAD_URL && (
                <a href={process.env.NEXT_PUBLIC_COMPANION_DOWNLOAD_URL}>
                  Windows 실행 파일 받기
                </a>
              )}
            </div>
            {!connected && (
              <p className="quality-note">
                로컬 프로그램이 없다면 먼저 실행 파일이 필요합니다.
                Chrome·Edge에서 로컬 네트워크 접근을 요청하면 허용해 주세요.
                모바일 기기에는 Windows 프로그램을 실행할 수 없습니다.
              </p>
            )}
          </div>
          {setup && (
            <section className="local-setup" aria-labelledby="setup-title">
              <h2 id="setup-title">첫 실행 준비</h2>
              <p>
                사이트에서 프로그램을 열려면 PC마다 처음 한 번 실행 연결을
                등록해 주세요.
              </p>
              <ol>
                <li>
                  <a href={process.env.NEXT_PUBLIC_COMPANION_DOWNLOAD_URL}>
                    Windows 실행 ZIP 받기
                  </a>{" "}
                  (약 107MB)
                </li>
                <li>ZIP 전체를 원하는 폴더에 압축 해제하세요.</li>
                <li>
                  <strong>사이트 연결 등록.cmd</strong>를 한 번 실행하세요.
                  Node.js·Python·FFmpeg는 함께 들어 있습니다.
                </li>
                <li>
                  아래 <strong>프로그램 실행</strong>을 누르고 브라우저의 열기
                  요청을 허용하세요.
                </li>
              </ol>
              <p>
                등록 후에는 링크 확인 버튼이 프로그램 실행을 요청합니다.
                Chrome·Edge가 로컬 네트워크 접근을 요청하면 허용해 주세요. 실행
                연결을 지원하지 않는 PC에서는 모아드롭 실행.cmd를 직접 켜세요.
                Windows x64용입니다.
              </p>
              <button type="button" onClick={launchLocal}>
                프로그램 실행
              </button>{" "}
              <p role="status">
                {setupExpired
                  ? "자동 연결 대기 시간이 끝났습니다. 프로그램을 실행한 뒤 ‘내 PC 연결하기’를 눌러 주세요."
                  : "프로그램 실행을 기다리고 있습니다. 연결되면 입력한 링크의 정보 조회를 자동으로 이어갑니다."}
              </p>
              <button
                type="button"
                onClick={() => {
                  resumeAfterSetup.current = null;
                  setSetup(false);
                }}
              >
                준비 안내 닫기
              </button>
            </section>
          )}
          <div className="workspace-heading">
            <span className="step-label">
              01 <span>링크 입력</span>
            </span>
            <span className="secure-label">
              <ShieldCheck size={14} /> 안전한 소스 확인
            </span>
          </div>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              analyzeFromClick();
            }}
          >
            <div className="url-input">
              <Link2 size={22} />
              <input
                aria-label="영상 URL"
                placeholder="영상 링크를 여기에 붙여넣으세요"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={busy || setup}
                type="url"
                required
                maxLength={2048}
              />
              <button
                type="button"
                className="paste"
                onClick={paste}
                disabled={busy || setup}
                aria-label="클립보드에서 붙여넣기"
              >
                <Clipboard size={16} />
                <span>붙여넣기</span>
              </button>
              <button
                className="analyze"
                disabled={loading || busy || connecting || setup}
              >
                {loading ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <>
                    링크 확인 <ArrowRight size={17} />
                  </>
                )}
              </button>
            </div>
            <div className="download-options request-options">
              <label>
                요청 파일 형식
                <div className="select-wrap">
                  <select
                    aria-label="요청 파일 형식"
                    value={tab === "video" ? "mp4" : "mp3"}
                    disabled={busy || loading || setup}
                    onChange={(e) => {
                      setTab(e.target.value === "mp4" ? "video" : "audio");
                      setMedia(null);
                      setFile("");
                      setMessage("");
                    }}
                  >
                    <option value="mp3">MP3 음원</option>
                    <option value="mp4">MP4 영상</option>
                  </select>
                  <ChevronDown size={15} />
                </div>
              </label>
              <label>
                {tab === "video" ? "요청 영상 화질" : "요청 음원 비트레이트"}
                <div className="select-wrap">
                  <select
                    aria-label={
                      tab === "video"
                        ? "요청 영상 화질"
                        : "요청 음원 비트레이트"
                    }
                    value={tab === "video" ? quality : bitrate}
                    disabled={busy || loading || setup}
                    onChange={(e) => {
                      if (tab === "video") setQuality(+e.target.value);
                      else setBitrate(+e.target.value);
                      setMedia(null);
                      setFile("");
                      setMessage("");
                    }}
                  >
                    {(tab === "video" ? VIDEO_QUALITIES : MP3_BITRATES).map(
                      (n) => (
                        <option key={n} value={n}>
                          {n}
                          {tab === "video" ? "p" : " kbps"}
                        </option>
                      ),
                    )}
                  </select>
                  <ChevronDown size={15} />
                </div>
              </label>
              <p className="quality-note">
                형식과 화질을 먼저 선택하세요. 실제로 제공되는 화질은 링크 확인
                후 표시됩니다.
              </p>
            </div>
          </form>
          <div className="input-bottom">
            <span>YouTube 영상·음원 다운로드 · 공개 영상 지원</span>
            <button
              disabled={busy || loading || connecting || setup}
              className="sample-button"
              onClick={() => {
                setUrl(SAMPLE);
                analyzeFromClick(SAMPLE, "video");
              }}
            >
              <Play size={12} fill="currentColor" /> 샘플로 체험하기{" "}
              <ArrowRight size={13} />
            </button>
          </div>
          {error && (
            <div className="error" role="alert">
              <span>{error}</span>
              <button
                aria-label="오류 메시지 닫기"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {loading && (
            <div className="loading" role="status">
              <LoaderCircle size={24} className="spin" /> 링크의 정보를 확인하고
              있어요.
            </div>
          )}
          {media && (
            <div className="result" ref={result}>
              <div className="media-info">
                <div className="thumb">
                  <img
                    src={media.thumbnail}
                    alt={media.title}
                    referrerPolicy="no-referrer"
                  />
                  {media.duration && (
                    <span>{durationText(media.duration, true)}</span>
                  )}
                </div>
                <div className="media-text">
                  <span className="source-badge">{media.source}</span>
                  <h2>{media.title}</h2>
                  <p>{media.author}</p>
                  <div className="media-meta">
                    {media.duration
                      ? durationText(media.duration)
                      : "길이 정보 미제공"}
                    {media.height && ` · 최대 ${media.height}p`}
                    {media.size &&
                      ` · ${(media.size / 1024 / 1024).toFixed(1)} MB`}
                  </div>
                </div>
              </div>
              {media.downloadable ? (
                <>
                  <div
                    className="tabs"
                    role="tablist"
                    aria-label="다운로드 종류"
                  >
                    <button
                      role="tab"
                      aria-selected={tab === "video"}
                      disabled={
                        busy ||
                        loading ||
                        (!media.qualities.length && !media.youtube)
                      }
                      className={tab === "video" ? "selected" : ""}
                      onClick={() => {
                        if (!media.qualities.length && media.youtube) {
                          void analyze(url, "video");
                          return;
                        }
                        setTab("video");
                        setFile("");
                        setMessage("");
                      }}
                    >
                      <Film size={17} /> 영상 다운로드
                    </button>
                    <button
                      role="tab"
                      aria-selected={tab === "audio"}
                      disabled={
                        busy ||
                        loading ||
                        (!media.convertible && !media.youtube)
                      }
                      className={tab === "audio" ? "selected" : ""}
                      onClick={() => {
                        if (!media.convertible && media.youtube) {
                          void analyze(url, "audio");
                          return;
                        }
                        setTab("audio");
                        setFile("");
                        setMessage("");
                      }}
                    >
                      <Headphones size={17} /> 음원 다운로드
                    </button>
                  </div>
                  <div className="download-options">
                    <label>
                      파일 형식
                      <div className="select-wrap">
                        <select
                          aria-label="파일 형식"
                          disabled={busy}
                          value={tab === "video" ? "mp4" : format}
                          onChange={(e) => {
                            setFormat(e.target.value);
                            setFile("");
                            setMessage("");
                          }}
                        >
                          {(tab === "video" ? ["mp4"] : ["mp3"]).map((f) => (
                            <option key={f} value={f}>
                              {f === "original"
                                ? `원본 ${media.nativeAudioFormat?.toUpperCase()} · 가장 빠름`
                                : f.toUpperCase()}
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={15} />
                      </div>
                    </label>
                    <label>
                      {tab === "video" ? "영상 화질" : "음원 비트레이트"}
                      <div className="select-wrap">
                        {tab === "video" ? (
                          <select
                            aria-label="영상 화질"
                            disabled={busy}
                            value={quality}
                            onChange={(e) => {
                              setQuality(+e.target.value);
                              setFile("");
                              setMessage("");
                            }}
                          >
                            {media.qualities.map((q) => (
                              <option key={q} value={q}>
                                {q}p
                                {q === media.height
                                  ? media.youtube
                                    ? " · 제공 화질"
                                    : " · 원본 해상도"
                                  : media.youtube
                                    ? " · 제공 화질"
                                    : " · 축소 변환"}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <select
                            aria-label="음원 비트레이트"
                            disabled={busy || format === "original"}
                            value={format === "original" ? "original" : bitrate}
                            onChange={(e) => {
                              setBitrate(+e.target.value);
                              setFile("");
                              setMessage("");
                            }}
                          >
                            {format === "original" ? (
                              <option value="original">
                                원본 유지
                                {media.audioBitrate
                                  ? ` · 약 ${media.audioBitrate} kbps`
                                  : ""}
                              </option>
                            ) : (
                              MP3_BITRATES.map((b) => (
                                <option key={b} value={b}>
                                  {b} kbps
                                </option>
                              ))
                            )}
                          </select>
                        )}
                        <ChevronDown size={15} />
                      </div>
                    </label>
                    <button
                      onClick={download}
                      className="download"
                      disabled={busy}
                    >
                      {busy ? (
                        <LoaderCircle size={18} className="spin" />
                      ) : (
                        <ArrowDownToLine size={18} />
                      )}{" "}
                      {busy ? "변환 중…" : "다운로드"}
                    </button>
                  </div>
                  {tab === "audio" && format === "original" && (
                    <p className="quality-note">
                      재인코딩 없이 원본 음질을 유지해 가장 빠르게 저장합니다.
                    </p>
                  )}
                  {tab === "audio" && format !== "original" && (
                    <p className="quality-note">
                      원본 음원
                      {media.audioBitrate
                        ? ` 약 ${media.audioBitrate}kbps`
                        : ""}
                      보다 높은 비트레이트로 변환해도 실제 음질은 좋아지지
                      않아요.
                    </p>
                  )}
                  {(busy || message) && (
                    <div
                      className="progress-section"
                      role="status"
                      aria-live="polite"
                    >
                      <div>
                        <span>
                          {file ? (
                            <CheckCircle2 size={16} />
                          ) : (
                            <LoaderCircle className="spin" size={16} />
                          )}{" "}
                          {message}
                        </span>
                        <strong>{progress}%</strong>
                      </div>
                      <progress
                        value={progress}
                        max={100}
                        aria-label="변환 진행률"
                      />
                      {file && (
                        <a
                          href={file}
                          download
                          onClick={async (e) => {
                            e.preventDefault();
                            try {
                              const link = await localDownload(completedToken);
                              const a = document.createElement("a");
                              a.href = link;
                              a.download = "";
                              document.body.appendChild(a);
                              a.click();
                              a.remove();
                            } catch (err) {
                              setError(
                                err instanceof Error
                                  ? err.message
                                  : "다운로드 연결에 실패했습니다.",
                              );
                            }
                          }}
                        >
                          다운로드가 시작되지 않았다면 여기를 눌러 저장하세요{" "}
                          <ArrowDownToLine size={13} />
                        </a>
                      )}
                      <small>
                        {busy && transferStats && (
                          <span style={{ display: "block", marginBottom: 6 }}>
                            {transferStats}
                          </span>
                        )}
                        완료 파일은 최대 24시간 보관하며, 저장 공간이 부족하면
                        먼저 삭제될 수 있습니다.
                      </small>
                    </div>
                  )}
                  <div className="permission-note">
                    <ShieldCheck size={15} />
                    <span>
                      {media.permission}
                      {!media.convertible &&
                        " · 음원 추출은 음원 트랙 또는 변환 권한이 없어 제공되지 않습니다."}
                    </span>
                  </div>
                </>
              ) : (
                <div className="blocked">
                  <ShieldCheck size={20} />
                  <div>
                    <strong>
                      {media.youtube
                        ? "이 서버에서 다운로드 연결에 실패했어요"
                        : "정보 조회만 가능한 링크예요"}
                    </strong>
                    <p>{media.permission}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
        <section className="features" id="guide">
          <article>
            <span className="feature-icon">
              <Film size={21} />
            </span>
            <h3>선명한 영상 그대로</h3>
            <p>
              MP4로 간편하게 저장하세요.
              <br />
              원본 해상도 이내에서 선택할 수 있어요.
            </p>
            <span className="feature-caption">
              MP4 <span>·</span> 최대 원본 화질
            </span>
          </article>
          <article>
            <span className="feature-icon">
              <AudioLines size={22} />
            </span>
            <h3>소리만 담고 싶을 때</h3>
            <p>
              필요한 음원만 가볍게 추출하세요.
              <br />
              용도에 맞는 형식과 비트레이트로.
            </p>
            <span className="feature-caption">
              MP3 <span>·</span> 96 / 128 / 256 / 320 kbps
            </span>
          </article>
          <article>
            <span className="feature-icon">
              <ShieldCheck size={22} />
            </span>
            <h3>안심하고 사용하는 도구</h3>
            <p>
              공개 영상과 등록된 소스를 처리하고,
              <br />
              변환한 임시 파일은 자동 삭제해요.
            </p>
            <span className="feature-caption">
              공개 소스 <span>·</span> URL 기록 최소화
            </span>
          </article>
        </section>
        <section className="howto">
          <div>
            <span className="section-kicker">이용 방법</span>
            <h2>세 단계면 충분해요.</h2>
          </div>
          <ol>
            <li>
              <span>1</span>
              <div>
                <strong>링크 붙여넣기</strong>
                <p>영상의 URL을 입력하세요.</p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>원하는 형식 선택</strong>
                <p>영상 또는 음원을 선택하세요.</p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>내 기기에 저장</strong>
                <p>변환이 끝나면 다운로드하세요.</p>
              </div>
            </li>
          </ol>
        </section>
        <div className="copyright">
          <ShieldCheck size={18} />
          <p>
            창작자의 권리를 함께 지켜요.
            <br />
            <span>
              콘텐츠 이용 시 저작권과 서비스 이용 조건을 준수해 주세요. 공개
              YouTube 영상의 다운로드·음원 추출을 지원하며, 로그인·접근
              제한·DRM은 우회하지 않습니다.
            </span>
          </p>
        </div>
      </main>
      <footer>
        <a href="/" className="footer-brand">
          <ArrowDownToLine size={16} /> 모아드롭
        </a>
        <span>당신의 순간을, 당신의 방식으로.</span>
        <span>© {new Date().getFullYear()} moadrop</span>
      </footer>
    </>
  );
}
