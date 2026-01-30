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
  Loader2,
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

// PRODUCTION: Audio player with instant play
class InstantAudioPlayer {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = "auto";
    this.audio.crossOrigin = "anonymous";
    this.currentSrc = null;
    this.isLoading = false;
    
    // Optimize for streaming
    this.audio.addEventListener('loadeddata', () => {
      this.isLoading = false;
    });
    
    this.audio.addEventListener('stalled', () => {
      console.warn('Audio stalled, attempting recovery');
      setTimeout(() => {
        if (this.audio.paused && this.currentSrc) {
          this.audio.load();
        }
      }, 100);
    });
  }
  
  async play(src) {
    if (this.currentSrc === src && this.audio.src) {
      // Same source, just play
      return this.audio.play();
    }
    
    this.currentSrc = src;
    this.isLoading = true;
    
    // Create new audio element for instant switching
    const newAudio = new Audio();
    newAudio.preload = "auto";
    newAudio.crossOrigin = "anonymous";
    newAudio.src = src;
    newAudio.volume = this.audio.volume;
    
    // Wait for enough data to play
    return new Promise((resolve, reject) => {
      const onCanPlay = () => {
        newAudio.removeEventListener('canplay', onCanPlay);
        newAudio.removeEventListener('error', onError);
        
        // Replace old audio
        this.audio.pause();
        this.audio = newAudio;
        this.isLoading = false;
        
        newAudio.play().then(resolve).catch(reject);
      };
      
      const onError = (error) => {
        newAudio.removeEventListener('canplay', onCanPlay);
        newAudio.removeEventListener('error', onError);
        reject(error);
      };
      
      newAudio.addEventListener('canplay', onCanPlay, { once: true });
      newAudio.addEventListener('error', onError, { once: true });
      
      // Start loading
      newAudio.load();
    });
  }
  
  pause() {
    this.audio.pause();
  }
  
  setVolume(volume) {
    this.audio.volume = volume;
  }
  
  setCurrentTime(time) {
    this.audio.currentTime = time;
  }
  
  getCurrentTime() {
    return this.audio.currentTime;
  }
  
  getDuration() {
    return this.audio.duration;
  }
  
  on(event, handler) {
    this.audio.addEventListener(event, handler);
    return () => this.audio.removeEventListener(event, handler);
  }
}

export default function App() {
  const audioPlayer = useRef(new InstantAudioPlayer());
  const playlistRef = useRef([]);
  const abortControllers = useRef(new Map());

  const apiBase = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
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
  const [isLoading, setIsLoading] = useState(false);
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

  // PRODUCTION: Prefetch with cancellation
  function prefetchStreamUrl(videoId) {
    // Cancel previous prefetch for same video
    if (abortControllers.current.has(videoId)) {
      abortControllers.current.get(videoId)?.abort();
    }
    
    const controller = new AbortController();
    abortControllers.current.set(videoId, controller);
    
    fetch(apiUrl(`/api/stream/${encodeURIComponent(videoId)}`), {
      method: "HEAD",
      signal: controller.signal,
      cache: 'force-cache'
    })
      .catch(() => {})
      .finally(() => {
        abortControllers.current.delete(videoId);
      });
  }

  async function runSearch(e) {
    e?.preventDefault?.();
    const q = query.trim();
    if (!q) return;

    setSearchLoading(true);
    setSearchError("");

    try {
      const res = await fetch(
        apiUrl(`/api/search?q=${encodeURIComponent(q)}&limit=12`),
        { cache: 'force-cache' }
      );
      if (!res.ok) throw new Error(`Search failed: ${res.status}`);
      const data = await res.json();
      setSearchResults(Array.isArray(data) ? data : []);
      
      // PRODUCTION: Prefetch first 3 results
      data.slice(0, 3).forEach(item => {
        prefetchStreamUrl(item.videoId);
      });
    } catch {
      setSearchError("Search failed. Please try again.");
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }

  async function toSong(videoId) {
    const res = await fetch(apiUrl(`/api/info/${encodeURIComponent(videoId)}`), {
      cache: 'force-cache'
    });
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

  // PRODUCTION: Instant play with optimistic UI
  async function playNowFromResult(result) {
    // Cancel any ongoing prefetches
    abortControllers.current.forEach(controller => controller.abort());
    abortControllers.current.clear();
    
    // Create optimistic song object
    const optimisticSong = {
      videoId: result.videoId,
      title: result.title,
      channelName: result.channelName,
      thumbnail: result.thumbnail,
      duration: result.duration || 0,
      isOptimistic: true
    };
    
    // INSTANT: Update UI immediately
    flushSync(() => {
      setPlaylist([optimisticSong]);
      setCurrentSongIndex(0);
      setIsPlaying(true);
      setIsLoading(true);
      setSearchError("");
      setPlayerError("");
    });
    
    try {
      // PRODUCTION: Play immediately while fetching details
      const streamUrl = apiUrl(`/api/stream/${encodeURIComponent(result.videoId)}`);
      
      await audioPlayer.current.play(streamUrl);
      
      setIsLoading(false);
      
      // Fetch complete info in background
      toSong(result.videoId)
        .then((fullSong) => {
          setPlaylist([{ ...fullSong, isOptimistic: false }]);
        })
        .catch(() => {
          // Keep optimistic data if fetch fails
          setPlaylist(prev => prev.map(s => 
            s.videoId === result.videoId ? { ...s, isOptimistic: false } : s
          ));
        });
        
    } catch (error) {
      console.error('Play failed:', error);
      setIsLoading(false);
      setIsPlaying(false);
      setPlayerError("Failed to play. Please try again.");
      
      // Remove from playlist if play fails
      setPlaylist([]);
    }
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
    
    setPlaylist([...currentPlaylist, song]);
    
    // Prefetch in background
    prefetchStreamUrl(result.videoId);
  }

  async function playAtIndex(index) {
    if (index < 0 || index >= playlist.length) return;
    
    const song = playlist[index];
    const streamUrl = apiUrl(`/api/stream/${encodeURIComponent(song.videoId)}`);
    
    setIsLoading(true);
    setCurrentSongIndex(index);
    
    try {
      await audioPlayer.current.play(streamUrl);
      setIsPlaying(true);
      setIsLoading(false);
    } catch (error) {
      console.error('Play failed:', error);
      setIsLoading(false);
      setPlayerError("Failed to play. Please try again.");
    }
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
        audioPlayer.current.pause();
      }

      return next;
    });
  }

  function clearQueue() {
    setPlaylist([]);
    setCurrentSongIndex(0);
    setIsPlaying(false);
    setIsLoading(false);
    setCurrentTime(0);
    setDuration(0);
    audioPlayer.current.pause();
    abortControllers.current.forEach(controller => controller.abort());
    abortControllers.current.clear();
  }

  async function togglePlay() {
    if (!currentSong) return;
    
    if (isPlaying) {
      audioPlayer.current.pause();
      setIsPlaying(false);
    } else {
      if (streamUrl) {
        setIsLoading(true);
        try {
          await audioPlayer.current.play(streamUrl);
          setIsPlaying(true);
          setIsLoading(false);
        } catch (error) {
          console.error('Play failed:', error);
          setIsLoading(false);
          setPlayerError("Failed to resume. Please try again.");
        }
      }
    }
  }

  function prevTrack() {
    if (!canPrev) return;
    playAtIndex(currentSongIndex - 1);
  }

  function nextTrack() {
    if (!canNext) {
      setIsPlaying(false);
      return;
    }
    playAtIndex(currentSongIndex + 1);
  }

  // Audio event listeners
  useEffect(() => {
    const player = audioPlayer.current;
    
    const unsubTimeUpdate = player.on('timeupdate', () => {
      setCurrentTime(player.getCurrentTime());
    });
    
    const unsubLoadedMetadata = player.on('loadedmetadata', () => {
      setDuration(player.getDuration());
    });
    
    const unsubEnded = player.on('ended', () => {
      nextTrack();
    });
    
    const unsubError = player.on('error', () => {
      setPlayerError("Audio error. Please try another song.");
      setIsPlaying(false);
      setIsLoading(false);
    });
    
    return () => {
      unsubTimeUpdate();
      unsubLoadedMetadata();
      unsubEnded();
      unsubError();
    };
  }, [currentSongIndex, playlist.length]);

  // Volume control
  useEffect(() => {
    audioPlayer.current.setVolume(volume);
  }, [volume]);

  // Handle play/pause state
  useEffect(() => {
    const player = audioPlayer.current;
    
    if (isPlaying && streamUrl && currentSong) {
      // Already handled by playAtIndex/togglePlay
    } else if (!isPlaying) {
      player.pause();
    }
  }, [isPlaying, streamUrl, currentSong]);

  // Handle song change
  useEffect(() => {
    if (currentSong && streamUrl && isPlaying) {
      setIsLoading(true);
      audioPlayer.current.play(streamUrl)
        .then(() => setIsLoading(false))
        .catch(error => {
          console.error('Auto-play failed:', error);
          setIsLoading(false);
          setIsPlaying(false);
        });
    }
  }, [currentSong?.videoId, isPlaying]);

  // PRODUCTION: Hover preloading
  const handleResultHover = (videoId) => {
    if (!playlist.some(s => s.videoId === videoId)) {
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
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-2xl font-semibold tracking-tight">
              YouTube Audio Player
            </div>
            <div className="text-sm text-slate-400">
              Instant streaming • Search, queue, and play
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
                  className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900 hover:bg-slate-800/50 transition-colors"
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
                          disabled={isLoading}
                          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
                        >
                          {isLoading && playlist[0]?.videoId === r.videoId ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
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
                <div className="p-4 text-sm text-slate-400">Queue is empty.</div>
              ) : (
                <div className="space-y-2">
                  {playlist.map((s, idx) => {
                    const active = idx === currentSongIndex;
                    const isOptimistic = s.isOptimistic;
                    
                    return (
                      <div
                        key={`${s.videoId}-${idx}`}
                        className={[
                          "flex items-center gap-3 rounded-lg border px-3 py-2",
                          active
                            ? "border-indigo-500 bg-indigo-500/10"
                            : "border-slate-800 bg-slate-950/30",
                          isOptimistic ? "opacity-80" : ""
                        ].join(" ")}
                      >
                        <button
                          type="button"
                          onClick={() => playAtIndex(idx)}
                          disabled={isLoading && active}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <div className="relative">
                            <img
                              src={s.thumbnail}
                              alt=""
                              className="h-10 w-10 rounded-md object-cover"
                            />
                            {isLoading && active && (
                              <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-md">
                                <Loader2 className="h-4 w-4 animate-spin text-white" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">
                              {s.title}
                              {isOptimistic && (
                                <span className="ml-2 text-xs text-slate-400">(loading...)</span>
                              )}
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
                <div className="relative">
                  <img
                    src={currentSong.thumbnail}
                    alt=""
                    className="h-12 w-12 rounded-lg object-cover"
                  />
                  {isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg">
                      <Loader2 className="h-4 w-4 animate-spin text-white" />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">
                    {currentSong.title}
                    {currentSong.isOptimistic && (
                      <span className="ml-2 text-xs text-slate-400">(loading details...)</span>
                    )}
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
                    disabled={!canPrev || isLoading}
                    className="rounded-lg p-2 text-slate-100 hover:bg-slate-900 disabled:opacity-40"
                    aria-label="Previous"
                  >
                    <SkipBack className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={togglePlay}
                    disabled={isLoading}
                    className="relative rounded-full bg-indigo-600 p-3 text-white hover:bg-indigo-500 disabled:opacity-60"
                    aria-label={isPlaying ? "Pause" : "Play"}
                  >
                    {isLoading ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : isPlaying ? (
                      <Pause className="h-5 w-5" />
                    ) : (
                      <Play className="h-5 w-5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={nextTrack}
                    disabled={!canNext || isLoading}
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
                      audioPlayer.current.setCurrentTime(next);
                    }}
                    className="w-full"
                    disabled={isLoading}
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