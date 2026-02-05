import {
  ListMusic,
  Pause,
  Play,
  Plus,
  Search,
  SkipBack,
  SkipForward,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export default function App() {
  const audioRef = useRef(null);
  const playlistRef = useRef([]);

  const apiBase = (import.meta.env.VITE_API_BASE ?? "")
    .trim()
    .replace(/\/$/, "");
  const apiUrl = useMemo(() => {
    return (path) => `${apiBase}${path}`;
  }, [apiBase]);

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [playerError, setPlayerError] = useState("");

  const [playlist, setPlaylist] = useState([]);
  const [currentSongIndex, setCurrentSongIndex] = useState(0);

  useEffect(() => {
    playlistRef.current = playlist;
  }, [playlist]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.9);

  const currentSong = playlist[currentSongIndex] ?? null;
  const canPrev = currentSongIndex > 0;
  const canNext = currentSongIndex < playlist.length - 1;

  const streamUrl = useMemo(() => {
    if (!currentSong?.videoId) return "";
    return apiUrl(`/api/stream/${encodeURIComponent(currentSong.videoId)}`);
  }, [apiUrl, currentSong?.videoId]);

  async function runSearch(e) {
    e?.preventDefault?.();
    const q = query.trim();
    if (!q) return;

    setSearchLoading(true);
    setSearchError("");

    try {
      const res = await fetch(apiUrl(`/api/search?q=${encodeURIComponent(q)}`));
      if (!res.ok) throw new Error(`Search failed: ${res.status}`);
      const data = await res.json();
      setSearchResults(Array.isArray(data) ? data : []);
    } catch {
      setSearchError("Search failed. Please try again.");
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }

  async function toSong(videoId) {
    const res = await fetch(apiUrl(`/api/info/${encodeURIComponent(videoId)}`));
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      try {
        const parsed = JSON.parse(text);
        throw new Error(parsed?.error || "Info failed");
      } catch {
        throw new Error(text || "Info failed");
      }
    }
    return res.json();
  }

  function prefetchStreamUrl(videoId) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    fetch(apiUrl(`/api/stream/${encodeURIComponent(videoId)}`), {
      method: "GET",
      headers: { Range: "bytes=0-1023" },
      keepalive: true,
      signal: controller.signal,
    })
      .then(() => console.log(`Prefetched: ${videoId}`))
      .catch(() => {})
      .finally(() => clearTimeout(timeoutId));
  }

  async function playNowFromResult(result) {
    // INSTANT PLAY: Use search result info immediately
    const song = {
      videoId: result.videoId,
      title: result.title,
      channelName: result.channelName,
      thumbnail: result.thumbnail,
      duration: result.duration || 0, // Use duration from search if available
    };

    // Immediately start playing with available info
    flushSync(() => {
      setPlaylist([song]);
      setCurrentSongIndex(0);
      setIsPlaying(true);
      setSearchError(""); // Clear any previous errors
    });

    // INSTANT: Prefetch stream immediately (don't wait)
    prefetchStreamUrl(result.videoId);

    // Fetch better details in background (non-blocking)
    toSong(result.videoId)
      .then((fullSong) => {
        // Update with complete info when it arrives
        setPlaylist([fullSong]);
      })
      .catch((err) => {
        console.warn("Background info fetch failed:", err);
        // Keep playing with the info we have
      });
  }

  function addToQueueFromResult(result) {
    const currentPlaylist = playlistRef.current;
    if (currentPlaylist.some((s) => s.videoId === result.videoId)) return;

    const song = {
      videoId: result.videoId,
      title: result.title,
      channelName: result.channelName,
      thumbnail: result.thumbnail,
      duration: result.duration || 0,
    };

    flushSync(() => {
      setPlaylist([...currentPlaylist, song]);
    });

    // Prefetch in background
    prefetchStreamUrl(result.videoId);

    // Update with full info in background
    toSong(result.videoId)
      .then((fullSong) => {
        setPlaylist((current) =>
          current.map((s) => (s.videoId === fullSong.videoId ? fullSong : s)),
        );
      })
      .catch(() => {
        // Silently fail - we have basic info
      });
  }

  function playAtIndex(index) {
    if (index < 0 || index >= playlist.length) return;
    const target = playlistRef.current[index];
    if (target?.videoId) prefetchStreamUrl(target.videoId);
    setCurrentSongIndex(index);
    setIsPlaying(true);
  }

  function removeAtIndex(index) {
    setPlaylist((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const next = prev.filter((_, i) => i !== index);

      setCurrentSongIndex((prevIndex) => {
        if (next.length === 0) return 0;
        if (index < prevIndex) return Math.max(0, prevIndex - 1);
        if (index > prevIndex) return prevIndex;
        return Math.min(prevIndex, next.length - 1);
      });

      if (next.length === 0) {
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);
      }

      return next;
    });
  }

  function clearQueue() {
    setPlaylist([]);
    setCurrentSongIndex(0);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.removeAttribute("src");
      a.load();
    }
  }

  function togglePlay() {
    const audio = audioRef.current;
    setPlayerError("");

    if (audio && streamUrl) {
      if (isPlaying) {
        audio.pause();
        setIsPlaying(false);
      } else {
        // Try immediate play
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => setIsPlaying(true))
            .catch((err) => {
              console.warn("Immediate play failed:", err);
              // Fallback to normal state change
              setIsPlaying(true);
            });
        } else {
          setIsPlaying(true);
        }
      }
    } else {
      setIsPlaying(!isPlaying);
    }
  }

  function prevTrack() {
    if (!canPrev) return;
    setCurrentSongIndex((i) => Math.max(0, i - 1));
    setIsPlaying(true);
  }

  function nextTrack() {
    if (!canNext) {
      setIsPlaying(false);
      return;
    }
    setCurrentSongIndex((i) => Math.min(playlist.length - 1, i + 1));
    setIsPlaying(true);
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
  }, [volume]);

  // INSTANT: Optimized stream loading
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    setPlayerError("");

    if (!streamUrl || !currentSong?.videoId) {
      // Only clear if we have no current song
      if (!currentSong?.videoId) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        setCurrentTime(0);
        setDuration(0);
      }
      return;
    }

    // Only change source if it's different
    const currentSrc = audio.src.replace(window.location.origin, "");
    const newSrc = streamUrl.replace(apiBase, "");

    if (currentSrc !== newSrc) {
      audio.src = streamUrl;
      audio.load();
      setCurrentTime(0);
      setDuration(0);
    }

    // INSTANT: Play immediately without waiting for metadata
    if (isPlaying) {
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn("Auto-play failed:", err);
          setIsPlaying(false);
          // Only show error if it's not a user gesture issue
          if (!err.message.includes("user gesture")) {
            setPlayerError("Autoplay blocked. Press Play.");
          }
        });
      }
    }
  }, [streamUrl, isPlaying, currentSong?.videoId, apiBase]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime || 0);
    const onLoaded = () => setDuration(audio.duration || 0);
    const onEnded = () => nextTrack();
    const onError = () => {
      setPlayerError("Audio failed to load. Try another video.");
      setIsPlaying(false);
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, [playlist.length, currentSongIndex]);

  // Add preloading on hover for better UX
  const handleResultHover = (videoId) => {
    if (!playlist.some((s) => s.videoId === videoId)) {
      prefetchStreamUrl(videoId);
    }
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === "Enter") {
      runSearch(e);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-32">
      <audio ref={audioRef} preload="auto" crossOrigin="anonymous" />

      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-2xl font-semibold tracking-tight">
              YouTube Audio Player
            </div>
            <div className="text-sm text-slate-400">
              Search, queue, and play audio only.
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-300">
            <ListMusic className="h-4 w-4" />
            <div>
              {playlist.length} in queue
              {currentSong ? ` • playing #${currentSongIndex + 1}` : ""}
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
          <div>
            <div className="flex gap-2">
              <div className="flex w-full items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3">
                <Search className="h-4 w-4 text-slate-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Search YouTube..."
                  className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-slate-500"
                />
              </div>
              <button
                type="button"
                onClick={runSearch}
                disabled={searchLoading}
                className="rounded-lg bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                {searchLoading ? "Searching..." : "Search"}
              </button>
            </div>

            {searchError ? (
              <div className="mt-3 text-sm text-rose-400">{searchError}</div>
            ) : null}
            {playerError ? (
              <div className="mt-3 text-sm text-rose-400">{playerError}</div>
            ) : null}

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {searchResults.map((r) => (
                <div
                  key={r.videoId}
                  className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900"
                  onMouseEnter={() => handleResultHover(r.videoId)}
                >
                  <div className="flex gap-3 p-3">
                    <img
                      src={r.thumbnail}
                      alt=""
                      className="h-16 w-28 flex-none rounded-md object-cover"
                      loading="lazy"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-100">
                        {r.title}
                      </div>
                      <div className="truncate text-xs text-slate-400">
                        {r.channelName}
                      </div>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => playNowFromResult(r)}
                          className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700"
                        >
                          <Play className="h-4 w-4" />
                          Play Now
                        </button>
                        <button
                          type="button"
                          onClick={() => addToQueueFromResult(r)}
                          className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700"
                        >
                          <Plus className="h-4 w-4" />
                          Add to Queue
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900">
            <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
              <div className="text-sm font-semibold">Queue</div>
              <button
                type="button"
                onClick={clearQueue}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-slate-100 hover:bg-slate-700"
              >
                <Trash2 className="h-4 w-4" />
                Clear
              </button>
            </div>

            <div className="max-h-[520px] overflow-auto p-2">
              {playlist.length === 0 ? (
                <div className="p-4 text-sm text-slate-400">
                  Queue is empty.
                </div>
              ) : (
                <div className="space-y-2">
                  {playlist.map((s, idx) => {
                    const active = idx === currentSongIndex;
                    return (
                      <div
                        key={`${s.videoId}-${idx}`}
                        className={[
                          "flex items-center gap-3 rounded-lg border px-3 py-2",
                          active
                            ? "border-indigo-500 bg-indigo-500/10"
                            : "border-slate-800 bg-slate-950/30",
                        ].join(" ")}
                      >
                        <button
                          type="button"
                          onClick={() => playAtIndex(idx)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <img
                            src={s.thumbnail}
                            alt=""
                            className="h-10 w-10 rounded-md object-cover"
                          />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">
                              {s.title}
                            </div>
                            <div className="truncate text-xs text-slate-400">
                              {s.channelName} • {formatTime(s.duration)}
                            </div>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => removeAtIndex(idx)}
                          className="rounded-lg p-2 text-slate-300 hover:bg-slate-800"
                          aria-label="Remove"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 border-t border-slate-800 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-4">
          {!currentSong ? (
            <div className="flex items-center justify-between gap-4">
              <div className="text-sm text-slate-400">
                Pick a video to start playing.
              </div>
              <div className="flex items-center gap-2 text-slate-500">
                <SkipBack className="h-5 w-5" />
                <Play className="h-5 w-5" />
                <SkipForward className="h-5 w-5" />
              </div>
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-[1fr_420px_1fr] lg:items-center">
              <div className="flex min-w-0 items-center gap-3">
                <img
                  src={currentSong.thumbnail}
                  alt=""
                  className="h-12 w-12 rounded-lg object-cover"
                />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">
                    {currentSong.title}
                  </div>
                  <div className="truncate text-xs text-slate-400">
                    {currentSong.channelName}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={prevTrack}
                    disabled={!canPrev}
                    className="rounded-lg p-2 text-slate-100 hover:bg-slate-900 disabled:opacity-40"
                    aria-label="Previous"
                  >
                    <SkipBack className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={togglePlay}
                    className="rounded-full bg-indigo-600 p-3 text-white hover:bg-indigo-500"
                    aria-label={isPlaying ? "Pause" : "Play"}
                  >
                    {isPlaying ? (
                      <Pause className="h-5 w-5" />
                    ) : (
                      <Play className="h-5 w-5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={nextTrack}
                    disabled={!canNext}
                    className="rounded-lg p-2 text-slate-100 hover:bg-slate-900 disabled:opacity-40"
                    aria-label="Next"
                  >
                    <SkipForward className="h-5 w-5" />
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-12 text-right text-xs tabular-nums text-slate-400">
                    {formatTime(currentTime)}
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={duration || 0}
                    step="0.25"
                    value={Math.min(currentTime, duration || 0)}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setCurrentTime(next);
                      const a = audioRef.current;
                      if (a) a.currentTime = next;
                    }}
                    className="w-full"
                  />
                  <div className="w-12 text-xs tabular-nums text-slate-400">
                    {formatTime(duration)}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3">
                <Volume2 className="h-4 w-4 text-slate-400" />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step="0.01"
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  className="w-36"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
