import cors from "cors";
import express from "express";
import { spawn } from "node:child_process";
import { Readable, pipeline } from "node:stream";
import yts from "yt-search";
import { LRUCache } from "lru-cache";
import { EventEmitter } from "events";

const app = express();
app.use(cors());
app.use(express.json());

// Increase JSON parser limit for large responses
app.use(express.json({ limit: '50mb' }));

function log(message, data = null) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
  if (data && process.env.NODE_ENV === 'development') console.log(JSON.stringify(data, null, 2));
}

function logError(message, error) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ERROR: ${message}`);
  if (error?.stack) console.error(error.stack);
}

const ytDlpPath = process.env.YTDLP_PATH || "yt-dlp";

// PRODUCTION: Use LRU cache with TTL and max size
const streamUrlCache = new LRUCache({
  max: 1000,
  ttl: 1000 * 60 * 60 * 3, // 3 hours
  updateAgeOnGet: true
});

const videoInfoCache = new LRUCache({
  max: 2000,
  ttl: 1000 * 60 * 60 * 24, // 24 hours
  updateAgeOnGet: true
});

// PRODUCTION: Request deduplication with timeout
const pendingRequests = new Map();
const requestEvents = new EventEmitter();
requestEvents.setMaxListeners(1000);

// PRODUCTION: Popular videos pre-warming
const popularVideos = new Set();
let isWarmingCache = false;

function warmCacheForPopularVideos() {
  if (isWarmingCache) return;
  isWarmingCache = true;
  
  // Pre-warm cache for trending music videos
  const trendingIds = [
    'dQw4w9WgXcQ', // Example - replace with actual trending IDs
    'kJQP7kiw5Fk',
    '09R8_2nJtjg'
  ];
  
  trendingIds.forEach(videoId => {
    if (!streamUrlCache.has(videoId)) {
      getStreamUrl(videoId).catch(() => {});
    }
  });
  
  setTimeout(() => { isWarmingCache = false; }, 10000);
}

// PRODUCTION: Optimized yt-dlp arguments for speed
const YTDLP_FAST_ARGS = [
  '--no-warnings',
  '--no-playlist',
  '--socket-timeout', '5',
  '--source-address', '0.0.0.0',
  '--throttled-rate', '100K',
  '--extractor-args', 'youtube:player_client=android,web;player_skip=configs',
  '--no-cache-dir',
  '--force-ipv4',
  '--geo-bypass',
  '--no-check-certificates',
  '--prefer-free-formats'
];

// PRODUCTION: Get all formats at once to choose the fastest
async function getAllFormats(videoId) {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  
  try {
    const { stdout } = await runYtDlp([
      ...YTDLP_FAST_ARGS,
      '--dump-json',
      videoUrl
    ], { timeoutMs: 8000 });
    
    const info = JSON.parse(stdout);
    return info.formats || [];
  } catch (error) {
    logError(`Failed to get formats for ${videoId}`, error);
    return [];
  }
}

// PRODUCTION: Select the fastest available audio format
function selectFastestAudioFormat(formats) {
  if (!Array.isArray(formats) || formats.length === 0) return null;
  
  // Filter audio-only formats
  const audioFormats = formats.filter(f => 
    f.vcodec === 'none' && 
    f.acodec !== 'none' &&
    f.filesize && 
    f.filesize < 50 * 1024 * 1024 // Less than 50MB
  );
  
  if (audioFormats.length === 0) return null;
  
  // Prioritize by: container > bitrate > size
  const formatPriority = [
    { container: 'm4a', priority: 10 },
    { container: 'mp4', priority: 9 },
    { container: 'webm', priority: 8 },
    { container: 'mp3', priority: 7 },
    { container: 'opus', priority: 6 }
  ];
  
  // Score each format
  const scoredFormats = audioFormats.map(format => {
    const container = (format.container || format.ext || '').toLowerCase();
    const priority = formatPriority.find(p => p.container === container)?.priority || 1;
    
    let score = priority * 1000;
    
    // Higher bitrate = higher score
    if (format.abr) score += format.abr;
    
    // Smaller filesize = higher score (for faster start)
    if (format.filesize) score += (100 - (format.filesize / (1024 * 1024)));
    
    // Prefer formats with known fast start
    if (format.protocol === 'http_dash_segments') score += 500;
    
    return { format, score };
  });
  
  // Return highest scoring format
  scoredFormats.sort((a, b) => b.score - a.score);
  return scoredFormats[0]?.format || audioFormats[0];
}

function toYouTubeWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function normalizeVideoId(videoIdOrUrl) {
  if (!videoIdOrUrl) return null;
  const input = String(videoIdOrUrl).trim();

  const idMatch = /^[a-zA-Z0-9_-]{11}$/.exec(input);
  if (idMatch) return input;

  try {
    const url = new URL(input);
    const v = url.searchParams.get("v");
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;

    const parts = url.pathname.split("/").filter(Boolean);
    const candidate = parts[0] === "watch" ? null : parts[parts.length - 1];
    if (candidate && /^[a-zA-Z0-9_-]{11}$/.test(candidate)) return candidate;
  } catch {
    return null;
  }

  return null;
}

function pickBestThumbnailFromYtDlpJson(json) {
  if (typeof json?.thumbnail === "string" && json.thumbnail)
    return json.thumbnail;
  const thumbs = Array.isArray(json?.thumbnails) ? json.thumbnails : [];
  if (thumbs.length === 0) return "";
  const best = thumbs.reduce(
    (acc, t) => ((t?.width ?? 0) > (acc?.width ?? 0) ? t : acc),
    thumbs[0]
  );
  return best?.url || "";
}

function runYtDlp(args, { timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ytDlpPath, args, { 
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
      reject(new Error("yt-dlp timed out"));
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      stdout += d.toString("utf8");
    });
    
    child.stderr.on("data", (d) => {
      stderr += d.toString("utf8");
    });

    child.on("error", (err) => {
      if (!killed) {
        clearTimeout(timer);
        reject(err);
      }
    });

    child.on("close", (code) => {
      if (!killed) {
        clearTimeout(timer);
        if (code === 0) return resolve({ stdout, stderr });
        reject(new Error(stderr.trim() || `yt-dlp failed (exit ${code})`));
      }
    });
  });
}

// PRODUCTION: Get stream URL with intelligent format selection
async function getStreamUrl(videoId) {
  // Check cache first
  const cached = streamUrlCache.get(videoId);
  if (cached) {
    log(`Cache hit for stream: ${videoId}`);
    return cached;
  }

  // Check for pending request
  if (pendingRequests.has(videoId)) {
    log(`Waiting for pending request: ${videoId}`);
    return new Promise((resolve, reject) => {
      const onSuccess = (url) => {
        requestEvents.removeListener(`stream:${videoId}:success`, onSuccess);
        requestEvents.removeListener(`stream:${videoId}:error`, onError);
        resolve(url);
      };
      
      const onError = (error) => {
        requestEvents.removeListener(`stream:${videoId}:success`, onSuccess);
        requestEvents.removeListener(`stream:${videoId}:error`, onError);
        reject(error);
      };
      
      requestEvents.once(`stream:${videoId}:success`, onSuccess);
      requestEvents.once(`stream:${videoId}:error`, onError);
    });
  }

  // Start new request
  pendingRequests.set(videoId, true);
  
  try {
    log(`Fetching optimized stream for: ${videoId}`);
    
    // METHOD 1: Try to get all formats and select fastest
    const formats = await getAllFormats(videoId);
    const bestFormat = selectFastestAudioFormat(formats);
    
    if (bestFormat && bestFormat.url) {
      log(`Selected format: ${bestFormat.ext || bestFormat.container} ${bestFormat.abr}kbps`);
      streamUrlCache.set(videoId, bestFormat.url);
      requestEvents.emit(`stream:${videoId}:success`, bestFormat.url);
      return bestFormat.url;
    }
    
    // METHOD 2: Fallback to traditional yt-dlp -g
    const videoUrl = toYouTubeWatchUrl(videoId);
    const { stdout } = await runYtDlp([
      ...YTDLP_FAST_ARGS,
      '-f', 'bestaudio[ext=m4a]/bestaudio/best',
      '-g',
      '--no-check-formats',
      videoUrl
    ], { timeoutMs: 8000 });

    const directUrl = String(stdout).trim().split(/\r?\n/).filter(Boolean)[0];
    if (!directUrl) throw new Error("No stream URL found");

    streamUrlCache.set(videoId, directUrl);
    requestEvents.emit(`stream:${videoId}:success`, directUrl);
    return directUrl;
    
  } catch (error) {
    logError(`Failed to get stream for ${videoId}`, error);
    requestEvents.emit(`stream:${videoId}:error`, error);
    throw error;
  } finally {
    pendingRequests.delete(videoId);
  }
}

// PRODUCTION: Get video info with fallback
async function getVideoInfo(videoId) {
  const cached = videoInfoCache.get(videoId);
  if (cached) return cached;

  if (pendingRequests.has(`info:${videoId}`)) {
    return new Promise((resolve, reject) => {
      const onSuccess = (info) => {
        requestEvents.removeListener(`info:${videoId}:success`, onSuccess);
        requestEvents.removeListener(`info:${videoId}:error`, onError);
        resolve(info);
      };
      
      const onError = (error) => {
        requestEvents.removeListener(`info:${videoId}:success`, onSuccess);
        requestEvents.removeListener(`info:${videoId}:error`, onError);
        reject(error);
      };
      
      requestEvents.once(`info:${videoId}:success`, onSuccess);
      requestEvents.once(`info:${videoId}:error`, onError);
    });
  }

  pendingRequests.set(`info:${videoId}`, true);
  
  try {
    const videoUrl = toYouTubeWatchUrl(videoId);
    const { stdout } = await runYtDlp([
      ...YTDLP_FAST_ARGS,
      '-j',
      videoUrl
    ], { timeoutMs: 10000 });
    
    const parsed = JSON.parse(stdout);
    const info = {
      videoId,
      title: parsed?.title || "Unknown Title",
      channelName: parsed?.channel || parsed?.uploader || "Unknown Channel",
      thumbnail: pickBestThumbnailFromYtDlpJson(parsed),
      duration: Number(parsed?.duration) || 0,
    };

    videoInfoCache.set(videoId, info);
    requestEvents.emit(`info:${videoId}:success`, info);
    return info;
  } catch (error) {
    requestEvents.emit(`info:${videoId}:error`, error);
    throw error;
  } finally {
    pendingRequests.delete(`info:${videoId}`);
  }
}

// PRODUCTION: Health endpoint with cache stats
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    cache: {
      streamUrls: streamUrlCache.size,
      videoInfo: videoInfoCache.size,
      pending: pendingRequests.size
    },
    memory: process.memoryUsage()
  });
});

// PRODUCTION: Info endpoint
app.get("/api/info/:videoId", async (req, res) => {
  const videoId = normalizeVideoId(req.params.videoId);

  if (!videoId) {
    return res.status(400).json({ error: "Invalid video ID" });
  }

  try {
    const info = await getVideoInfo(videoId);
    res.json(info);
  } catch (error) {
    logError(`Info failed: ${videoId}`, error);
    res.status(500).json({ error: error.message, videoId });
  }
});

// PRODUCTION: Search with cache warming
app.get("/api/search", async (req, res) => {
  const query = String(req.query.q ?? "").trim();
  const limit = Math.min(parseInt(req.query.limit) || 10, 20);

  if (!query) {
    return res.json([]);
  }

  try {
    const result = await yts({ query, pages: 1 });
    const videos = Array.isArray(result?.videos) ? result.videos : [];

    const response = videos.slice(0, limit).map((v) => ({
      videoId: v.videoId,
      title: v.title || "Unknown Title",
      thumbnail: v.thumbnail || "",
      channelName: v.author?.name || v.author || "Unknown Channel",
      duration: v.duration?.seconds || 0,
    }));

    // PRODUCTION: Pre-warm cache for search results in background
    setTimeout(() => {
      response.slice(0, 3).forEach(item => {
        if (!streamUrlCache.has(item.videoId)) {
          getStreamUrl(item.videoId).catch(() => {});
        }
      });
    }, 100);

    res.json(response);
  } catch (error) {
    logError(`Search failed: ${query}`, error);
    res.status(500).json({ error: "Search failed", query });
  }
});

// PRODUCTION: Ultra-fast streaming endpoint
app.get("/api/stream/:videoId", async (req, res) => {
  const videoId = normalizeVideoId(req.params.videoId);
  const range = req.headers.range;

  if (!videoId) {
    return res.status(400).json({ error: "Invalid video ID" });
  }

  // PRODUCTION: Try to serve from cache immediately
  const cachedUrl = streamUrlCache.get(videoId);
  if (cachedUrl) {
    log(`Stream cache hit: ${videoId}`);
    return proxyStream(cachedUrl, range, req, res, videoId);
  }

  // PRODUCTION: Start fetching in parallel while setting up response
  const streamPromise = getStreamUrl(videoId).catch(error => {
    logError(`Stream fetch failed: ${videoId}`, error);
    throw error;
  });

  // PRODUCTION: Immediate response setup
  try {
    // Set headers optimistically
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=7200");
    res.setHeader("Content-Type", "audio/mpeg");
    
    // Get stream URL (this will be fast if already cached or being fetched)
    const streamUrl = await streamPromise;
    return proxyStream(streamUrl, range, req, res, videoId);
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ 
        error: "Stream failed", 
        videoId,
        message: error.message 
      });
    }
  }
});

// PRODUCTION: Optimized proxy streaming
async function proxyStream(streamUrl, range, req, res, videoId) {
  const abortController = new AbortController();
  
  req.on("close", () => {
    abortController.abort();
  });

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Encoding': 'identity',
    'Connection': 'keep-alive',
  };

  if (range) {
    headers.Range = range;
  }

  try {
    const upstream = await fetch(streamUrl, {
      headers,
      signal: abortController.signal,
      redirect: 'follow'
    });

    if (!upstream.ok) {
      throw new Error(`Upstream error: ${upstream.status}`);
    }

    // Copy relevant headers
    const upstreamHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
    upstreamHeaders.forEach(header => {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    });

    // Additional headers for better caching
    res.setHeader("Cache-Control", "public, max-age=7200");
    res.setHeader("Access-Control-Allow-Origin", "*");
    
    if (upstream.body) {
      const readable = Readable.fromWeb(upstream.body);
      pipeline(readable, res, (error) => {
        if (error && !error.message.includes('aborted') && !error.message.includes('premature')) {
          logError(`Pipeline error for ${videoId}`, error);
        }
      });
    } else {
      res.end();
    }
  } catch (error) {
    if (abortController.signal.aborted) return;
    
    logError(`Proxy error for ${videoId}`, error);
    
    if (!res.headersSent) {
      res.status(500).json({ 
        error: "Stream proxy failed", 
        videoId 
      });
    }
  }
}

// PRODUCTION: Instant HEAD response with background fetch
app.head("/api/stream/:videoId", async (req, res) => {
  const videoId = normalizeVideoId(req.params.videoId);
  
  if (!videoId) {
    return res.status(400).end();
  }

  // Always respond immediately
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "public, max-age=7200");
  res.setHeader("Content-Type", "audio/mpeg");
  res.status(200).end();

  // Fetch in background for future plays
  if (!streamUrlCache.has(videoId)) {
    setTimeout(() => {
      getStreamUrl(videoId).catch(() => {});
    }, 0);
  }
});

// PRODUCTION: Cache management
app.get("/api/cache/stats", (req, res) => {
  res.json({
    streamUrls: {
      count: streamUrlCache.size,
      oldest: Array.from(streamUrlCache.keys())[0],
      newest: Array.from(streamUrlCache.keys()).slice(-1)[0]
    },
    videoInfo: {
      count: videoInfoCache.size
    }
  });
});

app.post("/api/cache/clear", (req, res) => {
  const streamCount = streamUrlCache.size;
  const infoCount = videoInfoCache.size;
  
  streamUrlCache.clear();
  videoInfoCache.clear();
  
  res.json({
    cleared: { streamUrls: streamCount, videoInfo: infoCount }
  });
});

// PRODUCTION: Pre-warm endpoint
app.post("/api/cache/warm/:videoId", async (req, res) => {
  const videoId = normalizeVideoId(req.params.videoId);
  
  if (!videoId) {
    return res.status(400).json({ error: "Invalid video ID" });
  }

  try {
    await getStreamUrl(videoId);
    res.json({ success: true, videoId, message: "Cache warmed" });
  } catch (error) {
    res.status(500).json({ error: error.message, videoId });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not found", path: req.path });
});

// Error handler
app.use((err, req, res, next) => {
  logError("App error", err);
  res.status(500).json({ error: "Internal server error" });
});

const port = Number(process.env.PORT ?? 3002);
app.listen(port, () => {
  log(`🚀 Production API on port ${port}`);
  // Start cache warming
  warmCacheForPopularVideos();
  setInterval(warmCacheForPopularVideos, 5 * 60 * 1000); // Every 5 minutes
});

// PRODUCTION: Monitor and cleanup
setInterval(() => {
  const memory = process.memoryUsage();
  if (memory.heapUsed > 500 * 1024 * 1024) { // 500MB
    log("High memory usage, clearing half of cache");
    // Clear half of oldest entries
    const keys = Array.from(streamUrlCache.keys());
    keys.slice(0, Math.floor(keys.length / 2)).forEach(key => {
      streamUrlCache.delete(key);
    });
  }
}, 60000); // Check every minute