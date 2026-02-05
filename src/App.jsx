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

function loadYouTubeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);

  return new Promise((resolve) => {
    const existing = document.querySelector('script[data-yt-iframe-api="1"]');

    if (existing) {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof previous === "function") previous();
        resolve(window.YT);
      };
      return;
    }

    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.async = true;
    tag.dataset.ytIframeApi = "1";

    const firstScript = document.getElementsByTagName("script")[0];
    if (firstScript?.parentNode) {
      firstScript.parentNode.insertBefore(tag, firstScript);
    } else {
      document.head.appendChild(tag);
    }

    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
  });
}

export default function App() {
  const playerRef = useRef(null);
  const playerReadyRef = useRef(false);
  const intervalRef = useRef(null);
  const playlistRef = useRef([]);

  const apiBase = (import.meta.env.VITE_API_BASE ?? "/")
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

  async function playNowFromResult(result) {
    const song = {
      videoId: result.videoId,
      title: result.title,
      channelName: result.channelName,
      thumbnail: result.thumbnail,
      duration: result.duration || 0,
    };

    flushSync(() => {
      setPlaylist([song]);
      setCurrentSongIndex(0);
      setIsPlaying(true);
      setSearchError("");
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

    setSearchError("");
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
    const player = playerRef.current;
    if (player && playerReadyRef.current) {
      player.stopVideo();
    }
  }

  function togglePlay() {
    setPlayerError("");
    const player = playerRef.current;
    if (!player || !playerReadyRef.current) {
      setIsPlaying((prev) => !prev);
      return;
    }
    if (isPlaying) {
      player.pauseVideo();
    } else {
      player.playVideo();
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

  const nextTrackRef = useRef(null);

  useEffect(() => {
    nextTrackRef.current = nextTrack;
  });

  useEffect(() => {
    let canceled = false;

    loadYouTubeApi().then((YT) => {
      if (canceled || playerRef.current) return;

      const playerConfig = {
        height: "0",
        width: "0",
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          rel: 0,
          playsinline: 1,
          modestbranding: 1,
        },
        events: {
          onReady: (event) => {
            playerReadyRef.current = true;
            event.target.setVolume(Math.round(volume * 100));
            const d = event.target.getDuration?.();
            if (Number.isFinite(d) && d > 0) setDuration(d);
            if (currentSong?.videoId && isPlaying) event.target.playVideo();
          },
          onStateChange: (event) => {
            if (!window.YT) return;
            const state = event.data;
            if (state === window.YT.PlayerState.ENDED) {
              nextTrackRef.current?.();
              return;
            }
            if (state === window.YT.PlayerState.PLAYING) {
              setIsPlaying(true);
              const d = event.target.getDuration?.();
              if (Number.isFinite(d) && d > 0) setDuration(d);
              return;
            }
            if (state === window.YT.PlayerState.PAUSED) {
              setIsPlaying(false);
            }
          },
          onError: () => {
            setPlayerError("Playback failed. Try another video.");
            setIsPlaying(false);
          },
        },
      };

      if (currentSong?.videoId) {
        playerConfig.videoId = currentSong.videoId;
      }

      playerRef.current = new YT.Player("yt-player", playerConfig);

      intervalRef.current = setInterval(() => {
        const player = playerRef.current;
        if (!player || !playerReadyRef.current) return;
        const t = player.getCurrentTime?.();
        if (Number.isFinite(t)) setCurrentTime(t);
        const d = player.getDuration?.();
        if (Number.isFinite(d) && d > 0) setDuration(d);
      }, 500);
    });

    return () => {
      canceled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      const player = playerRef.current;
      if (player?.destroy) player.destroy();
      playerRef.current = null;
      playerReadyRef.current = false;
    };
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !playerReadyRef.current) return;

    if (!currentSong?.videoId) {
      player.stopVideo();
      setCurrentTime(0);
      setDuration(0);
      return;
    }

    setCurrentTime(0);
    setDuration(0);
    player.loadVideoById(currentSong.videoId);
    if (!isPlaying) player.pauseVideo();
  }, [currentSong?.videoId]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !playerReadyRef.current) return;
    if (isPlaying) player.playVideo();
    else player.pauseVideo();
  }, [isPlaying]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !playerReadyRef.current) return;
    player.setVolume(Math.round(volume * 100));
  }, [volume]);

  const handleSearchKeyDown = (e) => {
    if (e.key === "Enter") {
      runSearch(e);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-32">
      <div id="yt-player" style={{ width: 0, height: 0, overflow: "hidden" }} />

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
                      const player = playerRef.current;
                      if (player && playerReadyRef.current) {
                        player.seekTo(next, true);
                      }
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
