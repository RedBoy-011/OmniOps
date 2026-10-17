import { useState, useEffect, useRef, useMemo, useCallback } from "react";

export interface VoiceNoteData {
  id?: string;
  sender: {
    name: string;
    role?: string;
    avatarUrl?: string;
    company?: string;
    badge?: string;
  };
  highlightedQuote: string;
  transcript: string;
  durationSeconds: number;
  audioUrl?: string;
  sttModel?: string;
  confidenceScore?: number;
  timestamp?: string;
  waveformAmplitudes?: number[];
}

export interface VoiceNotePlayerProps {
  data?: VoiceNoteData;
  compact?: boolean;
  className?: string;
  onTranscriptCopy?: (text: string) => void;
}

// Preset default waveform amplitudes (normalized 0.15 - 1.0)
const DEFAULT_WAVEFORM: number[] = [
  0.25, 0.45, 0.3, 0.6, 0.85, 0.7, 0.95, 0.5, 0.35, 0.75,
  0.9, 0.65, 0.4, 0.55, 0.8, 1.0, 0.85, 0.6, 0.7, 0.9,
  0.75, 0.5, 0.3, 0.65, 0.85, 0.95, 0.7, 0.45, 0.35, 0.6,
  0.8, 0.65, 0.5, 0.35, 0.25, 0.4
];

export const DEMO_VOICE_NOTES: VoiceNoteData[] = [
  {
    id: "vn-enterprise-01",
    sender: {
      name: "دکتر نیلوفر سپهری",
      role: "مدیر ارشد تیم زیرساخت و دواپس",
      company: "آریا پردازش ابر",
      badge: "مشتری سازمانی تأییدشده",
      avatarUrl: ""
    },
    highlightedQuote: "«با کلاسترهای لبه OmniOps و تبدیل لحظه‌ای صوت، هماهنگی مهندسان زیرساخت در شیفت‌های شبانه بدون نیاز به تایپ دستی گزارش‌ها ۷۰٪ سریع‌تر شد.»",
    transcript: "سلام به تیم توسعه OmniOps. در شیفت‌های حساس تست نفوذ و پایش پایداری کلاسترها، ضبط صوتی گزارش‌های فنی و تبدیل بلادرنگ آن‌ها با مدل Whisper به متن فارسی دقیق، زمان مستندسازی ما را از ۴۰ دقیقه به کمتر از ۵ دقیقه رساند. قابلیت هدایت فرامین شل از طریق وُیس در اپلیکیشن اندروید و کلاینت ویندوز، بالاترین استاندارد مهندسی است که تاکنون تجربه کرده‌ایم.",
    durationSeconds: 42,
    sttModel: "Whisper Large v3 · 128ms",
    confidenceScore: 99.4,
    timestamp: "امروز، ۱۴:۳۵",
    waveformAmplitudes: [
      0.3, 0.5, 0.35, 0.7, 0.9, 0.6, 0.85, 0.4, 0.3, 0.8,
      0.95, 0.7, 0.5, 0.6, 0.85, 1.0, 0.9, 0.65, 0.75, 0.95,
      0.8, 0.55, 0.35, 0.7, 0.9, 1.0, 0.75, 0.5, 0.4, 0.65,
      0.85, 0.7, 0.55, 0.4, 0.3, 0.45
    ]
  },
  {
    id: "vn-assistant-02",
    sender: {
      name: "دستیار صوتی OmniOps AI",
      role: "هسته تحلیل مهندسی و لاگ‌ها",
      company: "سامانه خودمختار OmniOps",
      badge: "ایجنت هوشمند سیستم",
      avatarUrl: ""
    },
    highlightedQuote: "«تحلیل سلامت سرورها با موفقیت تکمیل شد. تمامی ۸ مدل محلی Ollama با تأخیر کمتر از ۱۵ میلی‌ثانیه آماده پاسخگویی هستند.»",
    transcript: "گزارش وضعیت لحظه‌ای زیرساخت: نود عملیاتی OmniOps-02 در پایش دوره‌ای بدون قطعی گزارش شد. کَش پرامپت‌ها در وضعیت بهینه قرار دارد و هیچ هشدار بحرانی در پایشگر لاگ‌های مرکزی ثبت نشده است. پروکسی SOCKS5 با پایداری ۱۰۰ درصدی آماده اتصال به ارائه‌دهندگان مدل ابری است.",
    durationSeconds: 28,
    sttModel: "Faster-Whisper Distil · 48ms",
    confidenceScore: 99.8,
    timestamp: "امروز، ۱۵:۱۰",
    waveformAmplitudes: [
      0.2, 0.35, 0.6, 0.8, 0.7, 0.9, 0.85, 0.65, 0.4, 0.5,
      0.75, 0.9, 0.8, 0.6, 0.7, 0.85, 0.95, 0.7, 0.5, 0.65,
      0.8, 0.9, 0.75, 0.6, 0.45, 0.55, 0.7, 0.85, 0.6, 0.4,
      0.35, 0.5, 0.65, 0.4, 0.25, 0.3
    ]
  }
];

function formatTime(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function VoiceNotePlayer({
  data = DEMO_VOICE_NOTES[0],
  compact = false,
  className = "",
  onTranscriptCopy
}: VoiceNotePlayerProps) {
  // Player state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [isTranscriptOpen, setIsTranscriptOpen] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [activePresetIndex, setActivePresetIndex] = useState<number>(0);

  // Active voice note data (either props data or selected demo preset)
  const activeData = useMemo(() => {
    return data || DEMO_VOICE_NOTES[activePresetIndex] || DEMO_VOICE_NOTES[0];
  }, [data, activePresetIndex]);

  const duration = activeData.durationSeconds || 30;
  const amplitudes = activeData.waveformAmplitudes || DEFAULT_WAVEFORM;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);

  // Stop playback when data changes
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    lastTimeRef.current = null;
  }, [activeData.id]);

  // Audio simulation or real playback loop
  useEffect(() => {
    if (!isPlaying) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      lastTimeRef.current = null;
      return;
    }

    const step = (timestamp: number) => {
      if (!lastTimeRef.current) {
        lastTimeRef.current = timestamp;
      }

      const deltaSeconds = ((timestamp - lastTimeRef.current) / 1000) * playbackSpeed;
      lastTimeRef.current = timestamp;

      setCurrentTime(prevTime => {
        const nextTime = prevTime + deltaSeconds;
        if (nextTime >= duration) {
          setIsPlaying(false);
          return 0; // reset to beginning
        }
        return nextTime;
      });

      animationFrameRef.current = requestAnimationFrame(step);
    };

    animationFrameRef.current = requestAnimationFrame(step);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, duration, playbackSpeed]);

  // Toggle Play / Pause
  const handleTogglePlay = useCallback(() => {
    setIsPlaying(prev => !prev);
  }, []);

  // Speed cycle: 1x -> 1.25x -> 1.5x -> 2x -> 1x
  const handleCycleSpeed = useCallback(() => {
    setPlaybackSpeed(prev => {
      if (prev === 1.0) return 1.25;
      if (prev === 1.25) return 1.5;
      if (prev === 1.5) return 2.0;
      return 1.0;
    });
  }, []);

  // Scrub / Seek handling
  const handleSeek = (seconds: number) => {
    const clamped = Math.max(0, Math.min(seconds, duration));
    setCurrentTime(clamped);
  };

  const handleWaveformClick = (index: number) => {
    const fraction = index / amplitudes.length;
    handleSeek(fraction * duration);
  };

  const handleCopyTranscript = async () => {
    try {
      await navigator.clipboard.writeText(activeData.transcript);
      setCopied(true);
      if (onTranscriptCopy) onTranscriptCopy(activeData.transcript);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Fallback
      setCopied(false);
    }
  };

  // Progress fraction (0 to 1)
  const progressFraction = duration > 0 ? currentTime / duration : 0;
  const activeBarIndex = Math.floor(progressFraction * amplitudes.length);

  return (
    <section
      aria-label="پخش‌کننده یادداشت صوتی و رونوشت متنی هوش مصنوعی"
      className={`relative w-full overflow-hidden rounded-2xl border border-white/10 bg-[#16101d]/90 p-5 backdrop-blur-xl shadow-2xl transition-all duration-300 hover:border-pink-500/30 ${className}`}
    >
      {/* Background glow ambient highlights */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full bg-gradient-to-br from-pink-500/15 to-purple-600/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-20 -bottom-20 h-48 w-48 rounded-full bg-gradient-to-tr from-rose-500/10 to-indigo-600/10 blur-3xl"
      />

      {/* Preset selector bar (if multiple demos are available and data was not externally forced) */}
      {!compact && (
        <div className="mb-4 flex items-center justify-between border-b border-white/5 pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-pink-500" />
            </span>
            <span className="text-xs font-semibold tracking-wide text-pink-300">
              OmniOps Voice & STT Engine
            </span>
            {activeData.sttModel && (
              <span className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] font-mono text-zinc-400 border border-white/10">
                {activeData.sttModel}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {DEMO_VOICE_NOTES.map((sample, idx) => (
              <button
                key={sample.id}
                type="button"
                onClick={() => {
                  setActivePresetIndex(idx);
                }}
                className={`rounded-lg px-2.5 py-1 text-xs transition-all ${
                  activePresetIndex === idx
                    ? "bg-gradient-to-r from-pink-500 to-rose-600 text-white font-medium shadow-md shadow-pink-500/20"
                    : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white"
                }`}
              >
                نمونه {idx + 1}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Header: Customer / Sender Identity & Company Context */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3.5">
          {/* Avatar with status aura */}
          <div className="relative">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500 via-rose-500 to-purple-600 text-base font-bold text-white shadow-lg shadow-pink-500/25 ring-2 ring-white/10">
              {activeData.sender.avatarUrl ? (
                <img
                  src={activeData.sender.avatarUrl}
                  alt={activeData.sender.name}
                  className="h-full w-full rounded-xl object-cover"
                />
              ) : (
                <span>{activeData.sender.name.slice(0, 1)}</span>
              )}
            </div>
            {isPlaying && (
              <span
                aria-hidden="true"
                className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-[#16101d]"
              >
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
              </span>
            )}
          </div>

          {/* Identity details & company context */}
          <div className="flex flex-col">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-bold text-white sm:text-base">
                {activeData.sender.name}
              </h3>
              {activeData.sender.badge && (
                <span className="inline-flex items-center gap-1 rounded-full bg-pink-500/10 px-2.5 py-0.5 text-[11px] font-medium text-pink-300 ring-1 ring-inset ring-pink-500/20">
                  <svg
                    className="h-3 w-3"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.403 12.652a3 3 0 000-5.304 3 3 0 00-3.75-3.751 3 3 0 00-5.305 0 3 3 0 00-3.751 3.75 3 3 0 000 5.305 3 3 0 003.75 3.751 3 3 0 005.305 0 3 3 0 003.751-3.75zm-2.546-4.46a.75.75 0 00-1.214-.883l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {activeData.sender.badge}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs text-zinc-400 mt-0.5 flex-wrap">
              {activeData.sender.role && <span>{activeData.sender.role}</span>}
              {activeData.sender.company && (
                <>
                  <span className="text-zinc-600">·</span>
                  <span className="text-pink-300/80 font-medium">
                    {activeData.sender.company}
                  </span>
                </>
              )}
              {activeData.timestamp && (
                <>
                  <span className="text-zinc-600">·</span>
                  <span className="text-zinc-500">{activeData.timestamp}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Speed control pill */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCycleSpeed}
            aria-label={`تغییر سرعت بازپخش (سرعت فعلی ${playbackSpeed} برابر)`}
            title="تغییر سرعت بازپخش (۱x, ۱.۲۵x, ۱.۵x, ۲x)"
            className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-mono font-medium text-pink-300 transition-all hover:border-pink-500/40 hover:bg-pink-500/10 active:scale-95"
          >
            <span>⚡</span>
            <span>{playbackSpeed}x</span>
          </button>
        </div>
      </div>

      {/* Highlighted Quote Callout */}
      {activeData.highlightedQuote && (
        <div className="relative my-4 rounded-xl border border-pink-500/20 bg-gradient-to-r from-pink-950/30 via-purple-950/20 to-transparent p-3.5 pl-4">
          <div
            aria-hidden="true"
            className="absolute right-0 top-0 bottom-0 w-1 rounded-r-xl bg-gradient-to-b from-pink-400 to-rose-600"
          />
          <p className="text-xs sm:text-sm font-medium leading-relaxed text-pink-100/90 italic">
            {activeData.highlightedQuote}
          </p>
        </div>
      )}

      {/* Player Core: Controls, Interactive Waveform & Scrubbing */}
      <div className="mt-4 flex flex-col gap-3 rounded-xl border border-white/5 bg-black/30 p-3.5">
        <div className="flex items-center gap-3">
          {/* Main Play / Pause Button */}
          <button
            type="button"
            onClick={handleTogglePlay}
            aria-label={isPlaying ? "توقف پخش یادداشت صوتی" : "پخش یادداشت صوتی"}
            className="group relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-pink-500 via-rose-500 to-pink-400 text-white shadow-lg shadow-pink-500/30 transition-all duration-200 hover:scale-105 active:scale-95 hover:shadow-pink-500/50"
          >
            {isPlaying ? (
              <svg
                className="h-5 w-5 fill-current"
                viewBox="0 0 24 24"
              >
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
              <svg
                className="h-5 w-5 fill-current translate-x-0.5"
                viewBox="0 0 24 24"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Interactive Waveform Display */}
          <div
            className="flex h-11 flex-1 items-center gap-[3px] sm:gap-[4px] px-2 overflow-hidden cursor-pointer select-none"
            title="کلیک برای پرش به ثانیه مشخص"
            role="slider"
            aria-label="موقعیت بازپخش شکل موج صوتی"
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={Math.round(currentTime)}
            aria-valuetext={`${formatTime(currentTime)} از ${formatTime(duration)}`}
            tabIndex={0}
            onKeyDown={e => {
              if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                handleSeek(currentTime + 5);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                handleSeek(currentTime - 5);
              } else if (e.key === " ") {
                e.preventDefault();
                handleTogglePlay();
              }
            }}
          >
            {amplitudes.map((amp, idx) => {
              const isPast = idx <= activeBarIndex;
              const isCurrent = idx === activeBarIndex;
              // Bar height based on amplitude (min 20%, max 100%)
              const heightPercent = Math.max(20, Math.round(amp * 100));

              return (
                <button
                  key={idx}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleWaveformClick(idx);
                  }}
                  aria-label={`پرش به زمان ${formatTime((idx / amplitudes.length) * duration)}`}
                  className="group/bar relative flex-1 h-full flex items-center justify-center focus:outline-none"
                >
                  <span
                    style={{ height: `${heightPercent}%` }}
                    className={`w-full rounded-full transition-all duration-150 ${
                      isPast
                        ? "bg-gradient-to-t from-pink-500 to-rose-400 group-hover/bar:brightness-125"
                        : "bg-white/20 group-hover/bar:bg-white/40"
                    } ${isCurrent && isPlaying ? "animate-pulse scale-y-110 shadow-sm shadow-pink-400" : ""}`}
                  />
                </button>
              );
            })}
          </div>

          {/* Elapsed / Total Duration */}
          <div className="flex flex-col items-end justify-center font-mono text-xs text-zinc-400 min-w-[62px]">
            <span className="font-semibold text-white">
              {formatTime(currentTime)}
            </span>
            <span className="text-[11px] text-zinc-500">
              / {formatTime(duration)}
            </span>
          </div>
        </div>

        {/* Continuous Scrubbing Progress Track */}
        <div className="relative w-full px-1">
          <input
            type="range"
            min={0}
            max={duration}
            step={0.1}
            value={currentTime}
            onChange={(e) => handleSeek(parseFloat(e.target.value))}
            aria-label="نوار لغزنده پیشرفت صدا"
            className="w-full h-1.5 rounded-lg appearance-none cursor-pointer bg-white/10 accent-pink-500 hover:bg-white/20 transition-all focus:outline-none"
          />
        </div>
      </div>

      {/* Expandable Transcript Accordion */}
      <div className="mt-3.5 border-t border-white/5 pt-3">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setIsTranscriptOpen(prev => !prev)}
            aria-expanded={isTranscriptOpen}
            aria-controls="voice-note-transcript-panel"
            className="group flex items-center gap-2 text-xs font-medium text-zinc-300 transition-colors hover:text-pink-300 focus:outline-none"
          >
            <span
              className={`transform transition-transform duration-200 text-pink-400 ${
                isTranscriptOpen ? "rotate-180" : ""
              }`}
            >
              ▼
            </span>
            <span>
              {isTranscriptOpen
                ? "بستن رونوشت متنی (STT)"
                : "مشاهده رونوشت متنی تبدیل گفتار به متن (STT)"}
            </span>
            {activeData.confidenceScore && (
              <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-mono text-emerald-400 border border-emerald-500/20">
                {activeData.confidenceScore}% دقت
              </span>
            )}
          </button>

          {isTranscriptOpen && (
            <button
              type="button"
              onClick={handleCopyTranscript}
              aria-label="کپی متن رونوشت در کلیپ‌بورد"
              className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300 transition-all hover:border-pink-500/30 hover:bg-pink-500/10 hover:text-white"
            >
              {copied ? (
                <>
                  <span className="text-emerald-400">✓</span>
                  <span className="text-emerald-300 font-medium">کپی شد!</span>
                </>
              ) : (
                <>
                  <span>📋</span>
                  <span>کپی رونوشت</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Transcript Body */}
        {isTranscriptOpen && (
          <div
            id="voice-note-transcript-panel"
            role="region"
            aria-label="متن استخراج‌شده توسط هوش مصنوعی"
            className="mt-3 rounded-xl border border-white/10 bg-black/40 p-4 transition-all duration-300"
          >
            <div className="mb-2 flex items-center justify-between text-[11px] text-zinc-400 border-b border-white/5 pb-2">
              <span className="flex items-center gap-1.5 text-pink-300/90 font-mono">
                <span>🎙️</span>
                <span>مدل پردازش گفتار: {activeData.sttModel || "Whisper STT Local"}</span>
              </span>
              <span className="text-zinc-500 font-mono">
                مدت صوت: {activeData.durationSeconds} ثانیه
              </span>
            </div>

            <p className="text-xs sm:text-sm leading-relaxed text-zinc-200 text-justify font-normal select-text">
              {activeData.transcript}
            </p>
          </div>
        )}
      </div>

      {/* Hidden audio element for real audio playback if audioUrl is provided */}
      <audio
        ref={audioRef}
        src={activeData.audioUrl || undefined}
        preload="none"
        className="hidden"
      />
    </section>
  );
}

export default VoiceNotePlayer;
