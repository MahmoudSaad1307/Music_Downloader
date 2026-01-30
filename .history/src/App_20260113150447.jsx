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

  const currentSong = playlist[currentSongIndex] ?? null;

  const canPrev = currentSongIndex > 0;
  const canNext = currentSongIndex < playlist.length - 1;

  const streamUrl = useMemo(() => {
    if (!currentSong?.videoId) return "";
    return apiUrl(`/api/stream/${encodeURIComponent(currentSong.videoId)}`);
  }, [apiBase, currentSong?.videoId]);

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
    } catch (err) {
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

  async function playNowFromResult(result) {
    try {
      const song = await toSong(result.videoId);
      setPlaylist([song]);
      setCurrentSongIndex(0);
      setIsPlaying(true);
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : "Could not load video info."
      );
    }
  }

  async function addToQueueFromResult(result) {
    try {
      const song = await toSong(result.videoId);
      setPlaylist((prev) => {
        if (prev.some((s) => s.videoId === song.videoId)) return prev;
        return [...prev, song];
      });
    } catch (err) {
      setSearchError(
        err instanceof Error ? err.message : "Could not load video info."
      );
    }
  }

  function playAtIndex(index) {
    if (index < 0 || index >= playlist.length) return;
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
    setIsPlaying((p) => !p);
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

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!streamUrl) {
      audio.pause();
      return;
    }

    setPlayerError("");
    audio.src = streamUrl;
    audio.load();
    setCurrentTime(0);
    setDuration(0);

    if (isPlaying) {
      audio.play().catch(() => {
        setIsPlaying(false);
        setPlayerError("Autoplay blocked or audio failed. Press Play.");
      });
    }
  }, [streamUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!streamUrl) return;

    if (isPlaying) {
      audio.play().catch(() => {
        setIsPlaying(false);
        setPlayerError("Audio failed to start. Try another video.");
      });
    } else {
      audio.pause();
    }
  }, [isPlaying, streamUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime || 0);
    const onLoaded = () => setDuration(audio.duration || 0);
    const onEnded = () => nextTrack();
    const onError = () =>
      setPlayerError("Audio failed to load. Try another video.");

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

  return (
    <div className="min-h-screen pb-32">
      <audio ref={audioRef} />

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
                        {r.channelName} {r._id || r.i}
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
