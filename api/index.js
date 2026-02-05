import cors from "cors";
import express from "express";
import { Readable, pipeline } from "node:stream";
import yts from "yt-search";
import ytdl from "@distube/ytdl-core";

const app = express();
app.use(cors());
app.use(express.json());

function log(message, data = null) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
  if (data) console.log(JSON.stringify(data, null, 2));
}

function logError(message, error) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ERROR: ${message}`);
  console.error(error?.stack || error);
}

// IMPROVED: Separate caches for stream URLs and full video info
const streamUrlCache = new Map();
const videoInfoCache = new Map();
const STREAM_CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
const INFO_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// IMPROVED: In-flight request deduplication
const pendingStreamRequests = new Map();
const pendingInfoRequests = new Map();

function getCachedStreamUrl(videoId) {
  const cached = streamUrlCache.get(videoId);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > STREAM_CACHE_TTL_MS) {
    streamUrlCache.delete(videoId);
    return null;
  }
  return cached.url;
}

function setCachedStreamUrl(videoId, url) {
  streamUrlCache.set(videoId, { url, timestamp: Date.now() });
  log(`Cached stream URL for ${videoId} (${streamUrlCache.size} in cache)`);
}

function getCachedVideoInfo(videoId) {
  const cached = videoInfoCache.get(videoId);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > INFO_CACHE_TTL_MS) {
    videoInfoCache.delete(videoId);
    return null;
  }
  return cached.info;
}

function setCachedVideoInfo(videoId, info) {
  videoInfoCache.set(videoId, { info, timestamp: Date.now() });
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

// NEW: Fetch stream URL using ytdl-core
async function fetchStreamUrl(videoId) {
  // Check cache first
  const cached = getCachedStreamUrl(videoId);
  if (cached) {
    log(`Using cached stream URL for: ${videoId}`);
    return cached;
  }

  // Check if already fetching
  if (pendingStreamRequests.has(videoId)) {
    log(`Waiting for in-flight stream request: ${videoId}`);
    return pendingStreamRequests.get(videoId);
  }

  // Start new fetch
  const promise = (async () => {
    try {
      log(`Fetching stream URL for: ${videoId}`);
      const videoUrl = toYouTubeWatchUrl(videoId);

      // Get video info
      const info = await ytdl.getInfo(videoUrl);

      // Choose best audio format
      const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
      
      if (!audioFormats.length) {
        throw new Error('No audio formats found');
      }

      // Pick highest quality audio format
      const bestAudio = audioFormats.reduce((best, format) => {
        const bestBitrate = best.audioBitrate || 0;
        const currentBitrate = format.audioBitrate || 0;
        return currentBitrate > bestBitrate ? format : best;
      }, audioFormats[0]);

      const directUrl = bestAudio.url;
      
      if (!directUrl) throw new Error("No stream URL found");

      log(`Stream URL obtained for ${videoId}`);
      setCachedStreamUrl(videoId, directUrl);
      return directUrl;
    } finally {
      pendingStreamRequests.delete(videoId);
    }
  })();

  pendingStreamRequests.set(videoId, promise);
  return promise;
}

// NEW: Fetch video info using ytdl-core
async function fetchVideoInfo(videoId) {
  // Check cache first
  const cached = getCachedVideoInfo(videoId);
  if (cached) {
    log(`Using cached video info for: ${videoId}`);
    return cached;
  }

  // Check if already fetching
  if (pendingInfoRequests.has(videoId)) {
    log(`Waiting for in-flight info request: ${videoId}`);
    return pendingInfoRequests.get(videoId);
  }

  // Start new fetch
  const promise = (async () => {
    try {
      log(`Fetching video info for: ${videoId}`);
      const videoUrl = toYouTubeWatchUrl(videoId);
      
      const info = await ytdl.getBasicInfo(videoUrl);
      const details = info.videoDetails;

      const videoInfo = {
        videoId,
        title: details.title || "Unknown Title",
        channelName: details.author?.name || details.ownerChannelName || "Unknown Channel",
        thumbnail: details.thumbnails?.[details.thumbnails.length - 1]?.url || "",
        duration: Number(details.lengthSeconds) || 0,
      };

      setCachedVideoInfo(videoId, videoInfo);
      return videoInfo;
    } finally {
      pendingInfoRequests.delete(videoId);
    }
  })();

  pendingInfoRequests.set(videoId, promise);
  return promise;
}

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "YouTube Audio Player API",
    method: "ytdl-core",
    cacheStats: {
      streamUrls: streamUrlCache.size,
      videoInfo: videoInfoCache.size,
      pendingStreams: pendingStreamRequests.size,
      pendingInfo: pendingInfoRequests.size,
    },
  });
});

// Video info endpoint
app.get("/api/info/:videoId", async (req, res) => {
  const videoId = normalizeVideoId(req.params.videoId);

  if (!videoId) {
    log(`Invalid videoId received: ${req.params.videoId}`);
    return res.status(400).json({
      error: "Invalid video ID",
      videoId: req.params.videoId,
    });
  }

  try {
    const info = await fetchVideoInfo(videoId);
    return res.json(info);
  } catch (error) {
    logError(`Failed to fetch info for video: ${videoId}`, error);

    const errorMessage = error.message || "Failed to fetch video info";
    const statusCode = errorMessage.includes("Video unavailable") ? 404 : 500;

    return res.status(statusCode).json({
      error: errorMessage,
      videoId,
      details: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

// Search YouTube endpoint
app.get("/api/search", async (req, res) => {
  const query = String(req.query.q ?? "").trim();

  if (!query) {
    log("Empty search query received");
    return res.json([]);
  }

  log(`Searching for: ${query}`);

  try {
    const result = await yts(query);
    const videos = Array.isArray(result?.videos) ? result.videos : [];

    log(`Found ${videos.length} results for: ${query}`);

    const response = videos.slice(0, 10).map((v) => ({
      videoId: v.videoId,
      title: v.title || "Unknown Title",
      thumbnail: v.thumbnail || "",
      channelName: v.author?.name || v.author || "Unknown Channel",
      duration: v.duration?.seconds || 0,
    }));

    return res.json(response);
  } catch (error) {
    logError(`Search failed for query: ${query}`, error);
    return res.status(500).json({
      error: "Search failed. Please try again.",
      query,
    });
  }
});

// Stream endpoint
app.get("/api/stream/:videoId", async (req, res) => {
  const videoId = normalizeVideoId(req.params.videoId);

  if (!videoId) {
    log(`Invalid videoId received for streaming: ${req.params.videoId}`);
    return res.status(400).json({
      error: "Invalid video ID",
      videoId: req.params.videoId,
    });
  }

  log(
    `Stream request for video: ${videoId} (Range: ${req.headers.range || "none"})`,
  );

  try {
    // Fetch stream URL (cached or new)
    const directUrl = await fetchStreamUrl(videoId);

    const abortController = new AbortController();
    req.on("close", () => {
      try {
        abortController.abort();
      } catch {}
    });

    // Set appropriate headers for audio streaming
    const upstreamHeaders = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    };

    if (req.headers.range) upstreamHeaders.Range = req.headers.range;

    const upstream = await fetch(directUrl, {
      method: "GET",
      headers: upstreamHeaders,
      redirect: "follow",
      signal: abortController.signal,
    });

    // Set response headers for audio
    res.status(upstream.status);
    res.setHeader("Cache-Control", "public, max-age=7200");
    res.setHeader(
      "Accept-Ranges",
      upstream.headers.get("accept-ranges") || "bytes",
    );

    const contentType = upstream.headers.get("content-type") || "audio/mp4";
    res.setHeader("Content-Type", contentType);

    const contentLength = upstream.headers.get("content-length");
    if (contentLength) res.setHeader("Content-Length", contentLength);

    const contentRange = upstream.headers.get("content-range");
    if (contentRange) res.setHeader("Content-Range", contentRange);

    if (!upstream.body) {
      res.end();
      return;
    }

    const bodyStream = Readable.fromWeb(upstream.body);

    bodyStream.on("error", (err) => {
      if (
        abortController.signal.aborted ||
        req.aborted ||
        res.destroyed ||
        err?.name === "AbortError" ||
        err?.code === "ERR_STREAM_PREMATURE_CLOSE" ||
        err?.code === "ECONNRESET"
      )
        return;
      logError("Upstream stream error", err);
      try {
        res.destroy(err);
      } catch {}
    });

    res.on("close", () => {
      try {
        bodyStream.destroy();
      } catch {}
    });

    pipeline(bodyStream, res, (err) => {
      if (!err) return;
      if (
        abortController.signal.aborted ||
        req.aborted ||
        res.destroyed ||
        err?.name === "AbortError" ||
        err?.code === "ERR_STREAM_PREMATURE_CLOSE" ||
        err?.code === "ECONNRESET"
      )
        return;
      logError("Stream pipeline failed", err);
    });
  } catch (error) {
    if (error?.name === "AbortError") return;
    logError(`Failed to stream video: ${videoId}`, error);

    if (!res.headersSent) {
      const errorMessage = error.message || "Failed to stream audio";
      const statusCode = errorMessage.includes("unavailable") ? 404 : 500;

      return res.status(statusCode).json({
        error: errorMessage,
        videoId,
        suggestion:
          "This video may be restricted, unavailable, or require age verification.",
        details:
          process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }
});

// HEAD request
app.head("/api/stream/:videoId", async (req, res) => {
  const videoId = normalizeVideoId(req.params.videoId);

  if (!videoId) {
    return res.status(400).end();
  }

  // Try cache first for instant response
  const cached = getCachedStreamUrl(videoId);
  if (cached) {
    log(`HEAD request (cached): ${videoId}`);
    res.setHeader("Content-Type", "audio/mp4");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=7200");
    return res.status(200).end();
  }

  // If not cached, respond quickly anyway
  log(`HEAD request (uncached): ${videoId}`);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "public, max-age=7200");
  res.status(200).end();

  // Fetch in background for future requests
  fetchStreamUrl(videoId).catch(() => {});
});

// Cache management endpoints
app.post("/api/cache/clear", (req, res) => {
  const beforeStreams = streamUrlCache.size;
  const beforeInfo = videoInfoCache.size;

  streamUrlCache.clear();
  videoInfoCache.clear();

  log(`Cache cleared: ${beforeStreams} streams, ${beforeInfo} info entries`);

  res.json({
    message: "Cache cleared",
    cleared: {
      streamUrls: beforeStreams,
      videoInfo: beforeInfo,
    },
  });
});

app.get("/api/cache/stats", (req, res) => {
  res.json({
    streamUrls: {
      count: streamUrlCache.size,
      entries: Array.from(streamUrlCache.keys()),
    },
    videoInfo: {
      count: videoInfoCache.size,
      entries: Array.from(videoInfoCache.keys()),
    },
    pending: {
      streams: pendingStreamRequests.size,
      info: pendingInfoRequests.size,
    },
  });
});

// 404 handler
app.use((req, res) => {
  log(`404 - Route not found: ${req.method} ${req.path}`);
  res.status(404).json({
    error: "Route not found",
    path: req.path,
    availableEndpoints: [
      "GET /api/health",
      "GET /api/info/:videoId",
      "GET /api/search?q=query",
      "GET /api/stream/:videoId",
      "HEAD /api/stream/:videoId",
      "POST /api/cache/clear",
      "GET /api/cache/stats",
    ],
  });
});

// Global error handler
app.use((err, req, res, next) => {
  logError("Unhandled error", err);

  if (!res.headersSent) {
    res.status(500).json({
      error: "Internal server error",
      message: err.message,
      details: process.env.NODE_ENV === "development" ? err.stack : undefined,
    });
  } else {
    res.end();
  }
});

const port = Number(process.env.PORT ?? 3002);

if (!process.env.VERCEL) {
  app.listen(port, () => {
    log(`🚀 API listening on http://localhost:${port}`);
    log(`Health check: http://localhost:${port}/api/health`);
    log(`Environment: ${process.env.NODE_ENV || "development"}`);
  });
}

export default app;

// Periodic cache cleanup
setInterval(
  () => {
    const now = Date.now();
    let streamsCleaned = 0;
    let infoCleaned = 0;

    for (const [videoId, cached] of streamUrlCache.entries()) {
      if (now - cached.timestamp > STREAM_CACHE_TTL_MS) {
        streamUrlCache.delete(videoId);
        streamsCleaned++;
      }
    }

    for (const [videoId, cached] of videoInfoCache.entries()) {
      if (now - cached.timestamp > INFO_CACHE_TTL_MS) {
        videoInfoCache.delete(videoId);
        infoCleaned++;
      }
    }

    if (streamsCleaned > 0 || infoCleaned > 0) {
      log(
        `Cache cleanup: removed ${streamsCleaned} streams, ${infoCleaned} info entries`,
      );
    }
  },
  10 * 60 * 1000,
); // Every 10 minutes

process.on("unhandledRejection", (reason, promise) => {
  logError("Unhandled Rejection at:", { promise, reason });
});

process.on("uncaughtException", (error) => {
  logError("Uncaught Exception:", error);
  process.exit(1);
});