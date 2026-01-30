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

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export default function App() {
  const audioRef = useRef(null);

  const apiBase = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
  const apiUrl = (path) => `${apiBase}${path}`;

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [playerError, setPlayerError] = useState("");

  const [playlist, setPlaylist] = useState([]);
  const [currentSongIndex, setCurrentSongIndex] = useState(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.9);

  // Debug state
  const [debugLogs, setDebugLogs] = useState([]);

  const currentSong = playlist[currentSongIndex] ?? null;

  const canPrev = currentSongIndex > 0;
  const canNext = currentSongIndex < playlist.length - 1;

  const streamUrl = useMemo(() => {
    if (!currentSong?.videoId) return "";
    return apiUrl(`/api/stream/${encodeURIComponent(currentSong.videoId)}`);
  }, [apiBase, currentSong?.videoId]);

  // Enhanced logging function
  function addLog(message, data = null, type = "info") {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = {
      timestamp,
      message,
      data,
      type, // info, error, warning
    };
    console.log(`[${timestamp}] [${type.toUpperCase()}]`, message, data || "");
    setDebugLogs((prev) => [...prev.slice(-50), logEntry]); // Keep last 50 logs
  }

  async function runSearch(e) {
    e?.preventDefault?.();
    const q = query.trim();
    if (!q) return;

    setSearchLoading(true);
    setSearchError("");
    addLog("Starting search", { query: q });

    try {
      const url = apiUrl(`/api/search?q=${encodeURIComponent(q)}`);
      addLog("Fetching search results", { url });

      const res = await fetch(url);
      addLog("Search response received", {
        status: res.status,
        ok: res.ok,
        headers: Object.fromEntries(res.headers.entries()),
      });

      if (!res.ok) throw new Error(`Search failed: ${res.status}`);
      const data = await res.json();
      addLog("Search results parsed", { resultCount: data.length });

      setSearchResults(Array.isArray(data) ? data : []);
    } catch (err) {
      addLog("Search failed", { error: err.message }, "error");
      setSearchError("Search failed. Please try again.");
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }

  async function toSong(videoId) {
    addLog("Fetching video info", { videoId });

    const url = apiUrl(`/api/info/${encodeURIComponent(videoId)}`);
    addLog("Info URL", { url });

    const res = await fetch(url);
    addLog("Info response received", {
      status: res.status,
      ok: res.ok,
      contentType: res.headers.get("content-type"),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      addLog("Info request failed", { status: res.status, response: text }, "error");
      try {
        const parsed = JSON.parse(text);
        throw new Error(parsed?.error || "Info failed");
      } catch {
        throw new Error(text || "Info failed");
      }
    }
    const data = await res.json();
    addLog("Video info parsed successfully", data);
    return data;
  }

  async function playNowFromResult(result) {
    addLog("Play now clicked", result);
    try {
      const song = await toSong(result.videoId);
      setPlaylist([song]);
      setCurrentSongIndex(0);
      setIsPlaying(true);
      addLog("Song set to play", song);
    } catch (err) {
      addLog("Play now failed", { error: err.message }, "error");
      setSearchError(
        err instanceof Error ? err.message : "Could not load video info."
      );
    }
  }

  async function addToQueueFromResult(result) {
    addLog("Add to queue clicked", result);
    try {
      const song = await toSong(result.videoId);
      setPlaylist((prev) => {
        if (prev.some((s) => s.videoId === song.videoId)) {
          addLog("Song already in queue", { videoId: song.videoId }, "warning");
          return prev;
        }
        addLog("Song added to queue", song);
        return [...prev, song];
      });
    } catch (err) {
      addLog("Add to queue failed", { error: err.message }, "error");
      setSearchError(
        err instanceof Error ? err.message : "Could not load video info."
      );
    }
  }

  function playAtIndex(index) {
    addLog("Play at index", { index, total: playlist.length });
    if (index < 0 || index >= playlist.length) return;
    setCurrentSongIndex(index);
    setIsPlaying(true);
  }

  function removeAtIndex(index) {
    addLog("Remove at index", { index });
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
        addLog("Queue cleared");
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);
      }

      return next;
    });
  }

  function clearQueue() {
    addLog("Clear queue clicked");
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
    addLog("Toggle play", { currentlyPlaying: isPlaying });
    setIsPlaying((p) => !p);
  }

  function prevTrack() {
    if (!canPrev) return;
    addLog("Previous track");
    setCurrentSongIndex((i) => Math.max(0, i - 1));
    setIsPlaying(true);
  }

  function nextTrack() {
    if (!canNext) {
      addLog("No next track available");
      setIsPlaying(false);
      return;
    }
    addLog("Next track");
    setCurrentSongIndex((i) => Math.min(playlist.length - 1, i + 1));
    setIsPlaying(true);
  }

  // Volume effect
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    addLog("Volume changed", { volume });
  }, [volume]);

  // Stream URL change effect
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      addLog("Audio ref not available", null, "error");
      return;
    }

    if (!streamUrl) {
      addLog("No stream URL, pausing audio");
      audio.pause();
      return;
    }

    addLog("Stream URL changed", { streamUrl });
    setPlayerError("");

    // Test if URL is accessible
    fetch(streamUrl, { method: "HEAD" })
      .then((res) => {
        addLog("Stream URL HEAD request", {
          status: res.status,
          ok: res.ok,
          headers: Object.fromEntries(res.headers.entries()),
        });
      })
      .catch((err) => {
        addLog("Stream URL HEAD request failed", { error: err.message }, "error");
      });

    audio.src = streamUrl;
    addLog("Audio src set", { src: audio.src });

    audio.load();
    addLog("Audio load called");

    setCurrentTime(0);
    setDuration(0);

    if (isPlaying) {
      addLog("Attempting autoplay");
      audio.play().catch((err) => {
        addLog("Autoplay failed", { error: err.message, name: err.name }, "error");
        setIsPlaying(false);
        setPlayerError("Autoplay blocked or audio failed. Press Play.");
      });
    }
  }, [streamUrl]);

  // Play/pause effect
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!streamUrl) return;

    addLog("Play state changed", { isPlaying, streamUrl });

    if (isPlaying) {
      addLog("Calling audio.play()");
      audio.play().catch((err) => {
        addLog(
          "Audio play failed",
          {
            error: err.message,
            name: err.name,
            readyState: audio.readyState,
            networkState: audio.networkState,
          },
          "error"
        );
        setIsPlaying(false);
        setPlayerError("Audio failed to start. Try another video.");
      });
    } else {
      addLog("Calling audio.pause()");
      audio.pause();
    }
  }, [isPlaying, streamUrl]);

  // Audio event listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime || 0);
    };

    const onLoaded = () => {
      addLog("Audio metadata loaded", {
        duration: audio.duration,
        readyState: audio.readyState,
      });
      setDuration(audio.duration || 0);
    };

    const onEnded = () => {
      addLog("Audio ended");
      nextTrack();
    };

    const onError = (e) => {
      addLog(
        "Audio error event",
        {
          error: audio.error,
          code: audio.error?.code,
          message: audio.error?.message,
          readyState: audio.readyState,
          networkState: audio.networkState,
          src: audio.src,
        },
        "error"
      );
      setPlayerError("Audio failed to load. Try another video.");
    };

    const onLoadStart = () => {
      addLog("Audio load started");
    };

    const onCanPlay = () => {
      addLog("Audio can play", { readyState: audio.readyState });
    };

    const onWaiting = () => {
      addLog("Audio waiting/buffering");
    };

    const onStalled = () => {
      addLog("Audio stalled", null, "warning");
    };

    const onSuspend = () => {
      addLog("Audio suspended");
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.addEventListener("loadstart", onLoadStart);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("stalled", onStalled);
    audio.addEventListener("suspend", onSuspend);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("loadstart", onLoadStart);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("stalled", onStalled);
      audio.removeEventListener("suspend", onSuspend);
    };
  }, [playlist.length, currentSongIndex]);

  return (
    <div className="min-h-screen pb-32">
      <audio ref={audioRef} preload="metadata" crossOrigin="anonymous" />

      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Debug Panel */}
        <div className="mb-4 rounded-lg border border-yellow-800 bg-yellow-900/20 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold text-yellow-400">
              🔍 Debug Console
            </div>
            <button
              onClick={() => setDebugLogs([])}
              className="text-xs text-yellow-400 hover:text-yellow-300"
            >
              Clear Logs
            </button>
          </div>
          <div className="max-h-40 overflow-auto rounded bg-slate-950 p-2 font-mono text-xs">
            {debugLogs.length === 0 ? (
              <div className="text-slate-500">No logs yet...</div>
            ) : (
              debugLogs.map((log, idx) => (
                <div
                  key={idx}
                  className={[
                    "mb-1 border-l-2 pl-2",
                    log.type === "error"
                      ? "border-rose-500 text-rose-400"
                      : log.type === "warning"
                      ? "border-yellow-500 text-yellow-400"
                      : "border-slate-600 text-slate-300",
                  ].join(" ")}
                >
                  <span className="text-slate-500">[{log.timestamp}]</span>{" "}
                  {log.message}
                  {log.data && (
                    <div className="ml-4 text-slate-500">
                      {JSON.stringify(log.data)}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          <div className="mt-2 text-xs text-yellow-400">
            Current stream URL: {streamUrl || "None"}
          </div>
          <div className="text-xs text-yellow-400">
            API Base: {apiBase || "Not set (using relative URLs)"}
          </div>
        </div>

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
            <form onSubmit={runSearch} className="flex gap-2">
              <div className="flex w-full items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3">
                <Search className="h-4 w-4 text-slate-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search YouTube..."
                  className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-slate-500"
                />
              </div>
              <button
                type="submit"
                disabled={searchLoading}
                className="rounded-lg bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                {searchLoading ? "Searching..." : "Search"}
              </button>
            </form>

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
                        {r.channelName} {r.videoId}
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

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-center gap-3">
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
}import {
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

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export default function App() {
  const audioRef = useRef(null);

  const apiBase = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
  const apiUrl = (path) => `${apiBase}${path}`;

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [playerError, setPlayerError] = useState("");

  const [playlist, setPlaylist] = useState([]);
  const [currentSongIndex, setCurrentSongIndex] = useState(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.9);

  // Debug state
  const [debugLogs, setDebugLogs] = useState([]);

  const currentSong = playlist[currentSongIndex] ?? null;

  const canPrev = currentSongIndex > 0;
  const canNext = currentSongIndex < playlist.length - 1;

  const streamUrl = useMemo(() => {
    if (!currentSong?.videoId) return "";
    return apiUrl(`/api/stream/${encodeURIComponent(currentSong.videoId)}`);
  }, [apiBase, currentSong?.videoId]);

  // Enhanced logging function
  function addLog(message, data = null, type = "info") {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = {
      timestamp,
      message,
      data,
      type, // info, error, warning
    };
    console.log(`[${timestamp}] [${type.toUpperCase()}]`, message, data || "");
    setDebugLogs((prev) => [...prev.slice(-50), logEntry]); // Keep last 50 logs
  }

  async function runSearch(e) {
    e?.preventDefault?.();
    const q = query.trim();
    if (!q) return;

    setSearchLoading(true);
    setSearchError("");
    addLog("Starting search", { query: q });

    try {
      const url = apiUrl(`/api/search?q=${encodeURIComponent(q)}`);
      addLog("Fetching search results", { url });

      const res = await fetch(url);
      addLog("Search response received", {
        status: res.status,
        ok: res.ok,
        headers: Object.fromEntries(res.headers.entries()),
      });

      if (!res.ok) throw new Error(`Search failed: ${res.status}`);
      const data = await res.json();
      addLog("Search results parsed", { resultCount: data.length });

      setSearchResults(Array.isArray(data) ? data : []);
    } catch (err) {
      addLog("Search failed", { error: err.message }, "error");
      setSearchError("Search failed. Please try again.");
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }

  async function toSong(videoId) {
    addLog("Fetching video info", { videoId });

    const url = apiUrl(`/api/info/${encodeURIComponent(videoId)}`);
    addLog("Info URL", { url });

    const res = await fetch(url);
    addLog("Info response received", {
      status: res.status,
      ok: res.ok,
      contentType: res.headers.get("content-type"),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      addLog("Info request failed", { status: res.status, response: text }, "error");
      try {
        const parsed = JSON.parse(text);
        throw new Error(parsed?.error || "Info failed");
      } catch {
        throw new Error(text || "Info failed");
      }
    }
    const data = await res.json();
    addLog("Video info parsed successfully", data);
    return data;
  }

  async function playNowFromResult(result) {
    addLog("Play now clicked", result);
    try {
      const song = await toSong(result.videoId);
      setPlaylist([song]);
      setCurrentSongIndex(0);
      setIsPlaying(true);
      addLog("Song set to play", song);
    } catch (err) {
      addLog("Play now failed", { error: err.message }, "error");
      setSearchError(
        err instanceof Error ? err.message : "Could not load video info."
      );
    }
  }

  async function addToQueueFromResult(result) {
    addLog("Add to queue clicked", result);
    try {
      const song = await toSong(result.videoId);
      setPlaylist((prev) => {
        if (prev.some((s) => s.videoId === song.videoId)) {
          addLog("Song already in queue", { videoId: song.videoId }, "warning");
          return prev;
        }
        addLog("Song added to queue", song);
        return [...prev, song];
      });
    } catch (err) {
      addLog("Add to queue failed", { error: err.message }, "error");
      setSearchError(
        err instanceof Error ? err.message : "Could not load video info."
      );
    }
  }

  function playAtIndex(index) {
    addLog("Play at index", { index, total: playlist.length });
    if (index < 0 || index >= playlist.length) return;
    setCurrentSongIndex(index);
    setIsPlaying(true);
  }

  function removeAtIndex(index) {
    addLog("Remove at index", { index });
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
        addLog("Queue cleared");
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);
      }

      return next;
    });
  }

  function clearQueue() {
    addLog("Clear queue clicked");
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
    addLog("Toggle play", { currentlyPlaying: isPlaying });
    setIsPlaying((p) => !p);
  }

  function prevTrack() {
    if (!canPrev) return;
    addLog("Previous track");
    setCurrentSongIndex((i) => Math.max(0, i - 1));
    setIsPlaying(true);
  }

  function nextTrack() {
    if (!canNext) {
      addLog("No next track available");
      setIsPlaying(false);
      return;
    }
    addLog("Next track");
    setCurrentSongIndex((i) => Math.min(playlist.length - 1, i + 1));
    setIsPlaying(true);
  }

  // Volume effect
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    addLog("Volume changed", { volume });
  }, [volume]);

  // Stream URL change effect
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      addLog("Audio ref not available", null, "error");
      return;
    }

    if (!streamUrl) {
      addLog("No stream URL, pausing audio");
      audio.pause();
      return;
    }

    addLog("Stream URL changed", { streamUrl });
    setPlayerError("");

    // Test if URL is accessible
    fetch(streamUrl, { method: "HEAD" })
      .then((res) => {
        addLog("Stream URL HEAD request", {
          status: res.status,
          ok: res.ok,
          headers: Object.fromEntries(res.headers.entries()),
        });
      })
      .catch((err) => {
        addLog("Stream URL HEAD request failed", { error: err.message }, "error");
      });

    audio.src = streamUrl;
    addLog("Audio src set", { src: audio.src });

    audio.load();
    addLog("Audio load called");

    setCurrentTime(0);
    setDuration(0);

    if (isPlaying) {
      addLog("Attempting autoplay");
      audio.play().catch((err) => {
        addLog("Autoplay failed", { error: err.message, name: err.name }, "error");
        setIsPlaying(false);
        setPlayerError("Autoplay blocked or audio failed. Press Play.");
      });
    }
  }, [streamUrl]);

  // Play/pause effect
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!streamUrl) return;

    addLog("Play state changed", { isPlaying, streamUrl });

    if (isPlaying) {
      addLog("Calling audio.play()");
      audio.play().catch((err) => {
        addLog(
          "Audio play failed",
          {
            error: err.message,
            name: err.name,
            readyState: audio.readyState,
            networkState: audio.networkState,
          },
          "error"
        );
        setIsPlaying(false);
        setPlayerError("Audio failed to start. Try another video.");
      });
    } else {
      addLog("Calling audio.pause()");
      audio.pause();
    }
  }, [isPlaying, streamUrl]);

  // Audio event listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime || 0);
    };

    const onLoaded = () => {
      addLog("Audio metadata loaded", {
        duration: audio.duration,
        readyState: audio.readyState,
      });
      setDuration(audio.duration || 0);
    };

    const onEnded = () => {
      addLog("Audio ended");
      nextTrack();
    };

    const onError = (e) => {
      addLog(
        "Audio error event",
        {
          error: audio.error,
          code: audio.error?.code,
          message: audio.error?.message,
          readyState: audio.readyState,
          networkState: audio.networkState,
          src: audio.src,
        },
        "error"
      );
      setPlayerError("Audio failed to load. Try another video.");
    };

    const onLoadStart = () => {
      addLog("Audio load started");
    };

    const onCanPlay = () => {
      addLog("Audio can play", { readyState: audio.readyState });
    };

    const onWaiting = () => {
      addLog("Audio waiting/buffering");
    };

    const onStalled = () => {
      addLog("Audio stalled", null, "warning");
    };

    const onSuspend = () => {
      addLog("Audio suspended");
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.addEventListener("loadstart", onLoadStart);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("stalled", onStalled);
    audio.addEventListener("suspend", onSuspend);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("loadstart", onLoadStart);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("stalled", onStalled);
      audio.removeEventListener("suspend", onSuspend);
    };
  }, [playlist.length, currentSongIndex]);

  return (
    <div className="min-h-screen pb-32">
      <audio ref={audioRef} preload="metadata" crossOrigin="anonymous" />

      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Debug Panel */}
        <div className="mb-4 rounded-lg border border-yellow-800 bg-yellow-900/20 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold text-yellow-400">
              🔍 Debug Console
            </div>
            <button
              onClick={() => setDebugLogs([])}
              className="text-xs text-yellow-400 hover:text-yellow-300"
            >
              Clear Logs
            </button>
          </div>
          <div className="max-h-40 overflow-auto rounded bg-slate-950 p-2 font-mono text-xs">
            {debugLogs.length === 0 ? (
              <div className="text-slate-500">No logs yet...</div>
            ) : (
              debugLogs.map((log, idx) => (
                <div
                  key={idx}
                  className={[
                    "mb-1 border-l-2 pl-2",
                    log.type === "error"
                      ? "border-rose-500 text-rose-400"
                      : log.type === "warning"
                      ? "border-yellow-500 text-yellow-400"
                      : "border-slate-600 text-slate-300",
                  ].join(" ")}
                >
                  <span className="text-slate-500">[{log.timestamp}]</span>{" "}
                  {log.message}
                  {log.data && (
                    <div className="ml-4 text-slate-500">
                      {JSON.stringify(log.data)}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          <div className="mt-2 text-xs text-yellow-400">
            Current stream URL: {streamUrl || "None"}
          </div>
          <div className="text-xs text-yellow-400">
            API Base: {apiBase || "Not set (using relative URLs)"}
          </div>
        </div>

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
            <form onSubmit={runSearch} className="flex gap-2">
              <div className="flex w-full items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3">
                <Search className="h-4 w-4 text-slate-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search YouTube..."
                  className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-slate-500"
                />
              </div>
              <button
                type="submit"
                disabled={searchLoading}
                className="rounded-lg bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                {searchLoading ? "Searching..." : "Search"}
              </button>
            </form>

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
                        {r.channelName} {r.videoId}
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

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-center gap-3">
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
}import {
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

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export default function App() {
  const audioRef = useRef(null);

  const apiBase = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
  const apiUrl = (path) => `${apiBase}${path}`;

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [playerError, setPlayerError] = useState("");

  const [playlist, setPlaylist] = useState([]);
  const [currentSongIndex, setCurrentSongIndex] = useState(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.9);

  // Debug state
  const [debugLogs, setDebugLogs] = useState([]);

  const currentSong = playlist[currentSongIndex] ?? null;

  const canPrev = currentSongIndex > 0;
  const canNext = currentSongIndex < playlist.length - 1;

  const streamUrl = useMemo(() => {
    if (!currentSong?.videoId) return "";
    return apiUrl(`/api/stream/${encodeURIComponent(currentSong.videoId)}`);
  }, [apiBase, currentSong?.videoId]);

  // Enhanced logging function
  function addLog(message, data = null, type = "info") {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = {
      timestamp,
      message,
      data,
      type, // info, error, warning
    };
    console.log(`[${timestamp}] [${type.toUpperCase()}]`, message, data || "");
    setDebugLogs((prev) => [...prev.slice(-50), logEntry]); // Keep last 50 logs
  }

  async function runSearch(e) {
    e?.preventDefault?.();
    const q = query.trim();
    if (!q) return;

    setSearchLoading(true);
    setSearchError("");
    addLog("Starting search", { query: q });

    try {
      const url = apiUrl(`/api/search?q=${encodeURIComponent(q)}`);
      addLog("Fetching search results", { url });

      const res = await fetch(url);
      addLog("Search response received", {
        status: res.status,
        ok: res.ok,
        headers: Object.fromEntries(res.headers.entries()),
      });

      if (!res.ok) throw new Error(`Search failed: ${res.status}`);
      const data = await res.json();
      addLog("Search results parsed", { resultCount: data.length });

      setSearchResults(Array.isArray(data) ? data : []);
    } catch (err) {
      addLog("Search failed", { error: err.message }, "error");
      setSearchError("Search failed. Please try again.");
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }

  async function toSong(videoId) {
    addLog("Fetching video info", { videoId });

    const url = apiUrl(`/api/info/${encodeURIComponent(videoId)}`);
    addLog("Info URL", { url });

    const res = await fetch(url);
    addLog("Info response received", {
      status: res.status,
      ok: res.ok,
      contentType: res.headers.get("content-type"),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      addLog("Info request failed", { status: res.status, response: text }, "error");
      try {
        const parsed = JSON.parse(text);
        throw new Error(parsed?.error || "Info failed");
      } catch {
        throw new Error(text || "Info failed");
      }
    }
    const data = await res.json();
    addLog("Video info parsed successfully", data);
    return data;
  }

  async function playNowFromResult(result) {
    addLog("Play now clicked", result);
    try {
      const song = await toSong(result.videoId);
      setPlaylist([song]);
      setCurrentSongIndex(0);
      setIsPlaying(true);
      addLog("Song set to play", song);
    } catch (err) {
      addLog("Play now failed", { error: err.message }, "error");
      setSearchError(
        err instanceof Error ? err.message : "Could not load video info."
      );
    }
  }

  async function addToQueueFromResult(result) {
    addLog("Add to queue clicked", result);
    try {
      const song = await toSong(result.videoId);
      setPlaylist((prev) => {
        if (prev.some((s) => s.videoId === song.videoId)) {
          addLog("Song already in queue", { videoId: song.videoId }, "warning");
          return prev;
        }
        addLog("Song added to queue", song);
        return [...prev, song];
      });
    } catch (err) {
      addLog("Add to queue failed", { error: err.message }, "error");
      setSearchError(
        err instanceof Error ? err.message : "Could not load video info."
      );
    }
  }

  function playAtIndex(index) {
    addLog("Play at index", { index, total: playlist.length });
    if (index < 0 || index >= playlist.length) return;
    setCurrentSongIndex(index);
    setIsPlaying(true);
  }

  function removeAtIndex(index) {
    addLog("Remove at index", { index });
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
        addLog("Queue cleared");
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);
      }

      return next;
    });
  }

  function clearQueue() {
    addLog("Clear queue clicked");
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
    addLog("Toggle play", { currentlyPlaying: isPlaying });
    setIsPlaying((p) => !p);
  }

  function prevTrack() {
    if (!canPrev) return;
    addLog("Previous track");
    setCurrentSongIndex((i) => Math.max(0, i - 1));
    setIsPlaying(true);
  }

  function nextTrack() {
    if (!canNext) {
      addLog("No next track available");
      setIsPlaying(false);
      return;
    }
    addLog("Next track");
    setCurrentSongIndex((i) => Math.min(playlist.length - 1, i + 1));
    setIsPlaying(true);
  }

  // Volume effect
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    addLog("Volume changed", { volume });
  }, [volume]);

  // Stream URL change effect
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      addLog("Audio ref not available", null, "error");
      return;
    }

    if (!streamUrl) {
      addLog("No stream URL, pausing audio");
      audio.pause();
      return;
    }

    addLog("Stream URL changed", { streamUrl });
    setPlayerError("");

    // Test if URL is accessible
    fetch(streamUrl, { method: "HEAD" })
      .then((res) => {
        addLog("Stream URL HEAD request", {
          status: res.status,
          ok: res.ok,
          headers: Object.fromEntries(res.headers.entries()),
        });
      })
      .catch((err) => {
        addLog("Stream URL HEAD request failed", { error: err.message }, "error");
      });

    audio.src = streamUrl;
    addLog("Audio src set", { src: audio.src });

    audio.load();
    addLog("Audio load called");

    setCurrentTime(0);
    setDuration(0);

    if (isPlaying) {
      addLog("Attempting autoplay");
      audio.play().catch((err) => {
        addLog("Autoplay failed", { error: err.message, name: err.name }, "error");
        setIsPlaying(false);
        setPlayerError("Autoplay blocked or audio failed. Press Play.");
      });
    }
  }, [streamUrl]);

  // Play/pause effect
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!streamUrl) return;

    addLog("Play state changed", { isPlaying, streamUrl });

    if (isPlaying) {
      addLog("Calling audio.play()");
      audio.play().catch((err) => {
        addLog(
          "Audio play failed",
          {
            error: err.message,
            name: err.name,
            readyState: audio.readyState,
            networkState: audio.networkState,
          },
          "error"
        );
        setIsPlaying(false);
        setPlayerError("Audio failed to start. Try another video.");
      });
    } else {
      addLog("Calling audio.pause()");
      audio.pause();
    }
  }, [isPlaying, streamUrl]);

  // Audio event listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime || 0);
    };

    const onLoaded = () => {
      addLog("Audio metadata loaded", {
        duration: audio.duration,
        readyState: audio.readyState,
      });
      setDuration(audio.duration || 0);
    };

    const onEnded = () => {
      addLog("Audio ended");
      nextTrack();
    };

    const onError = (e) => {
      addLog(
        "Audio error event",
        {
          error: audio.error,
          code: audio.error?.code,
          message: audio.error?.message,
          readyState: audio.readyState,
          networkState: audio.networkState,
          src: audio.src,
        },
        "error"
      );
      setPlayerError("Audio failed to load. Try another video.");
    };

    const onLoadStart = () => {
      addLog("Audio load started");
    };

    const onCanPlay = () => {
      addLog("Audio can play", { readyState: audio.readyState });
    };

    const onWaiting = () => {
      addLog("Audio waiting/buffering");
    };

    const onStalled = () => {
      addLog("Audio stalled", null, "warning");
    };

    const onSuspend = () => {
      addLog("Audio suspended");
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.addEventListener("loadstart", onLoadStart);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("stalled", onStalled);
    audio.addEventListener("suspend", onSuspend);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("loadstart", onLoadStart);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("stalled", onStalled);
      audio.removeEventListener("suspend", onSuspend);
    };
  }, [playlist.length, currentSongIndex]);

  return (
    <div className="min-h-screen pb-32">
      <audio ref={audioRef} preload="metadata" crossOrigin="anonymous" />

      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Debug Panel */}
        <div className="mb-4 rounded-lg border border-yellow-800 bg-yellow-900/20 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold text-yellow-400">
              🔍 Debug Console
            </div>
            <button
              onClick={() => setDebugLogs([])}
              className="text-xs text-yellow-400 hover:text-yellow-300"
            >
              Clear Logs
            </button>
          </div>
          <div className="max-h-40 overflow-auto rounded bg-slate-950 p-2 font-mono text-xs">
            {debugLogs.length === 0 ? (
              <div className="text-slate-500">No logs yet...</div>
            ) : (
              debugLogs.map((log, idx) => (
                <div
                  key={idx}
                  className={[
                    "mb-1 border-l-2 pl-2",
                    log.type === "error"
                      ? "border-rose-500 text-rose-400"
                      : log.type === "warning"
                      ? "border-yellow-500 text-yellow-400"
                      : "border-slate-600 text-slate-300",
                  ].join(" ")}
                >
                  <span className="text-slate-500">[{log.timestamp}]</span>{" "}
                  {log.message}
                  {log.data && (
                    <div className="ml-4 text-slate-500">
                      {JSON.stringify(log.data)}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          <div className="mt-2 text-xs text-yellow-400">
            Current stream URL: {streamUrl || "None"}
          </div>
          <div className="text-xs text-yellow-400">
            API Base: {apiBase || "Not set (using relative URLs)"}
          </div>
        </div>

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
            <form onSubmit={runSearch} className="flex gap-2">
              <div className="flex w-full items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3">
                <Search className="h-4 w-4 text-slate-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search YouTube..."
                  className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-slate-500"
                />
              </div>
              <button
                type="submit"
                disabled={searchLoading}
                className="rounded-lg bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                {searchLoading ? "Searching..." : "Search"}
              </button>
            </form>

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
                        {r.channelName} {r.videoId}
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

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-center gap-3">
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
}import {
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

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export default function App() {
  const audioRef = useRef(null);

  const apiBase = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
  const apiUrl = (path) => `${apiBase}${path}`;

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [playerError, setPlayerError] = useState("");

  const [playlist, setPlaylist] = useState([]);
  const [currentSongIndex, setCurrentSongIndex] = useState(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.9);

  // Debug state
  const [debugLogs, setDebugLogs] = useState([]);

  const currentSong = playlist[currentSongIndex] ?? null;

  const canPrev = currentSongIndex > 0;
  const canNext = currentSongIndex < playlist.length - 1;

  const streamUrl = useMemo(() => {
    if (!currentSong?.videoId) return "";
    return apiUrl(`/api/stream/${encodeURIComponent(currentSong.videoId)}`);
  }, [apiBase, currentSong?.videoId]);

  // Enhanced logging function
  function addLog(message, data = null, type = "info") {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = {
      timestamp,
      message,
      data,
      type, // info, error, warning
    };
    console.log(`[${timestamp}] [${type.toUpperCase()}]`, message, data || "");
    setDebugLogs((prev) => [...prev.slice(-50), logEntry]); // Keep last 50 logs
  }

  async function runSearch(e) {
    e?.preventDefault?.();
    const q = query.trim();
    if (!q) return;

    setSearchLoading(true);
    setSearchError("");
    addLog("Starting search", { query: q });

    try {
      const url = apiUrl(`/api/search?q=${encodeURIComponent(q)}`);
      addLog("Fetching search results", { url });

      const res = await fetch(url);
      addLog("Search response received", {
        status: res.status,
        ok: res.ok,
        headers: Object.fromEntries(res.headers.entries()),
      });

      if (!res.ok) throw new Error(`Search failed: ${res.status}`);
      const data = await res.json();
      addLog("Search results parsed", { resultCount: data.length });

      setSearchResults(Array.isArray(data) ? data : []);
    } catch (err) {
      addLog("Search failed", { error: err.message }, "error");
      setSearchError("Search failed. Please try again.");
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }

  async function toSong(videoId) {
    addLog("Fetching video info", { videoId });

    const url = apiUrl(`/api/info/${encodeURIComponent(videoId)}`);
    addLog("Info URL", { url });

    const res = await fetch(url);
    addLog("Info response received", {
      status: res.status,
      ok: res.ok,
      contentType: res.headers.get("content-type"),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      addLog("Info request failed", { status: res.status, response: text }, "error");
      try {
        const parsed = JSON.parse(text);
        throw new Error(parsed?.error || "Info failed");
      } catch {
        throw new Error(text || "Info failed");
      }
    }
    const data = await res.json();
    addLog("Video info parsed successfully", data);
    return data;
  }

  async function playNowFromResult(result) {
    addLog("Play now clicked", result);
    try {
      const song = await toSong(result.videoId);
      setPlaylist([song]);
      setCurrentSongIndex(0);
      setIsPlaying(true);
      addLog("Song set to play", song);
    } catch (err) {
      addLog("Play now failed", { error: err.message }, "error");
      setSearchError(
        err instanceof Error ? err.message : "Could not load video info."
      );
    }
  }

  async function addToQueueFromResult(result) {
    addLog("Add to queue clicked", result);
    try {
      const song = await toSong(result.videoId);
      setPlaylist((prev) => {
        if (prev.some((s) => s.videoId === song.videoId)) {
          addLog("Song already in queue", { videoId: song.videoId }, "warning");
          return prev;
        }
        addLog("Song added to queue", song);
        return [...prev, song];
      });
    } catch (err) {
      addLog("Add to queue failed", { error: err.message }, "error");
      setSearchError(
        err instanceof Error ? err.message : "Could not load video info."
      );
    }
  }

  function playAtIndex(index) {
    addLog("Play at index", { index, total: playlist.length });
    if (index < 0 || index >= playlist.length) return;
    setCurrentSongIndex(index);
    setIsPlaying(true);
  }

  function removeAtIndex(index) {
    addLog("Remove at index", { index });
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
        addLog("Queue cleared");
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);
      }

      return next;
    });
  }

  function clearQueue() {
    addLog("Clear queue clicked");
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
    addLog("Toggle play", { currentlyPlaying: isPlaying });
    setIsPlaying((p) => !p);
  }

  function prevTrack() {
    if (!canPrev) return;
    addLog("Previous track");
    setCurrentSongIndex((i) => Math.max(0, i - 1));
    setIsPlaying(true);
  }

  function nextTrack() {
    if (!canNext) {
      addLog("No next track available");
      setIsPlaying(false);
      return;
    }
    addLog("Next track");
    setCurrentSongIndex((i) => Math.min(playlist.length - 1, i + 1));
    setIsPlaying(true);
  }

  // Volume effect
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    addLog("Volume changed", { volume });
  }, [volume]);

  // Stream URL change effect
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      addLog("Audio ref not available", null, "error");
      return;
    }

    if (!streamUrl) {
      addLog("No stream URL, pausing audio");
      audio.pause();
      return;
    }

    addLog("Stream URL changed", { streamUrl });
    setPlayerError("");

    // Test if URL is accessible
    fetch(streamUrl, { method: "HEAD" })
      .then((res) => {
        addLog("Stream URL HEAD request", {
          status: res.status,
          ok: res.ok,
          headers: Object.fromEntries(res.headers.entries()),
        });
      })
      .catch((err) => {
        addLog("Stream URL HEAD request failed", { error: err.message }, "error");
      });

    audio.src = streamUrl;
    addLog("Audio src set", { src: audio.src });

    audio.load();
    addLog("Audio load called");

    setCurrentTime(0);
    setDuration(0);

    if (isPlaying) {
      addLog("Attempting autoplay");
      audio.play().catch((err) => {
        addLog("Autoplay failed", { error: err.message, name: err.name }, "error");
        setIsPlaying(false);
        setPlayerError("Autoplay blocked or audio failed. Press Play.");
      });
    }
  }, [streamUrl]);

  // Play/pause effect
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!streamUrl) return;

    addLog("Play state changed", { isPlaying, streamUrl });

    if (isPlaying) {
      addLog("Calling audio.play()");
      audio.play().catch((err) => {
        addLog(
          "Audio play failed",
          {
            error: err.message,
            name: err.name,
            readyState: audio.readyState,
            networkState: audio.networkState,
          },
          "error"
        );
        setIsPlaying(false);
        setPlayerError("Audio failed to start. Try another video.");
      });
    } else {
      addLog("Calling audio.pause()");
      audio.pause();
    }
  }, [isPlaying, streamUrl]);

  // Audio event listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime || 0);
    };

    const onLoaded = () => {
      addLog("Audio metadata loaded", {
        duration: audio.duration,
        readyState: audio.readyState,
      });
      setDuration(audio.duration || 0);
    };

    const onEnded = () => {
      addLog("Audio ended");
      nextTrack();
    };

    const onError = (e) => {
      addLog(
        "Audio error event",
        {
          error: audio.error,
          code: audio.error?.code,
          message: audio.error?.message,
          readyState: audio.readyState,
          networkState: audio.networkState,
          src: audio.src,
        },
        "error"
      );
      setPlayerError("Audio failed to load. Try another video.");
    };

    const onLoadStart = () => {
      addLog("Audio load started");
    };

    const onCanPlay = () => {
      addLog("Audio can play", { readyState: audio.readyState });
    };

    const onWaiting = () => {
      addLog("Audio waiting/buffering");
    };

    const onStalled = () => {
      addLog("Audio stalled", null, "warning");
    };

    const onSuspend = () => {
      addLog("Audio suspended");
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.addEventListener("loadstart", onLoadStart);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("stalled", onStalled);
    audio.addEventListener("suspend", onSuspend);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("loadstart", onLoadStart);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("stalled", onStalled);
      audio.removeEventListener("suspend", onSuspend);
    };
  }, [playlist.length, currentSongIndex]);

  return (
    <div className="min-h-screen pb-32">
      <audio ref={audioRef} preload="metadata" crossOrigin="anonymous" />

      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Debug Panel */}
        <div className="mb-4 rounded-lg border border-yellow-800 bg-yellow-900/20 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold text-yellow-400">
              🔍 Debug Console
            </div>
            <button
              onClick={() => setDebugLogs([])}
              className="text-xs text-yellow-400 hover:text-yellow-300"
            >
              Clear Logs
            </button>
          </div>
          <div className="max-h-40 overflow-auto rounded bg-slate-950 p-2 font-mono text-xs">
            {debugLogs.length === 0 ? (
              <div className="text-slate-500">No logs yet...</div>
            ) : (
              debugLogs.map((log, idx) => (
                <div
                  key={idx}
                  className={[
                    "mb-1 border-l-2 pl-2",
                    log.type === "error"
                      ? "border-rose-500 text-rose-400"
                      : log.type === "warning"
                      ? "border-yellow-500 text-yellow-400"
                      : "border-slate-600 text-slate-300",
                  ].join(" ")}
                >
                  <span className="text-slate-500">[{log.timestamp}]</span>{" "}
                  {log.message}
                  {log.data && (
                    <div className="ml-4 text-slate-500">
                      {JSON.stringify(log.data)}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          <div className="mt-2 text-xs text-yellow-400">
            Current stream URL: {streamUrl || "None"}
          </div>
          <div className="text-xs text-yellow-400">
            API Base: {apiBase || "Not set (using relative URLs)"}
          </div>
        </div>

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
            <form onSubmit={runSearch} className="flex gap-2">
              <div className="flex w-full items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3">
                <Search className="h-4 w-4 text-slate-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search YouTube..."
                  className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-slate-500"
                />
              </div>
              <button
                type="submit"
                disabled={searchLoading}
                className="rounded-lg bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                {searchLoading ? "Searching..." : "Search"}
              </button>
            </form>

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
                        {r.channelName} {r.videoId}
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

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-center gap-3">
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