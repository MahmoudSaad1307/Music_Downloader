import cors from "cors";
import express from "express";
import { spawn } from "node:child_process";
import { Readable, pipeline } from "node:stream";
import yts from "yt-search";

const app = express();
app.use(cors());
app.use(express.json());

// Enhanced logging
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

const ytDlpPath = process.env.YTDLP_PATH || "yt-dlp";

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

function runYtDlp(args, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ytDlpPath, args, { windowsHide: true });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
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
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(stderr.trim() || `yt-dlp failed (exit ${code})`));
    });
  });
}

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "YouTube Audio Player API",
  });
});

// Get video info endpoint
app.get("/api/info/:videoId", async (req, res) => {
  const videoId = normalizeVideoId(req.params.videoId);

  if (!videoId) {
    log(`Invalid videoId received: ${req.params.videoId}`);
    return res.status(400).json({
      error: "Invalid video ID",
      videoId: req.params.videoId,
    });
  }

  log(`Fetching info for video: ${videoId}`);

  try {
    const videoUrl = toYouTubeWatchUrl(videoId);
    const { stdout } = await runYtDlp(
      ["-j", "--no-playlist", "--no-warnings", videoUrl],
      { timeoutMs: 45_000 }
    );
    const parsed = JSON.parse(stdout);

    const response = {
      videoId,
      title: parsed?.title || "Unknown Title",
      channelName: parsed?.channel || parsed?.uploader || "Unknown Channel",
      thumbnail: pickBestThumbnailFromYtDlpJson(parsed),
      duration: Number(parsed?.duration) || 0,
    };

    log(`Successfully fetched info for: ${response.title}`);
    return res.json(response);
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

// Stream audio endpoint - WITH PROPER RANGE SUPPORT
app.get("/api/stream/:videoId", async (req, res) => {
  const videoId = normalizeVideoId(req.params.videoId);

  if (!videoId) {
    log(`Invalid videoId received for streaming: ${req.params.videoId}`);
    return res.status(400).json({
      error: "Invalid video ID",
      videoId: req.params.videoId,
    });
  }

  log(`========================================`);
  log(`Streaming request for video: ${videoId}`);
  log(`Range header: ${req.headers.range || "none"}`);

  try {
    const videoUrl = toYouTubeWatchUrl(videoId);
    const { stdout } = await runYtDlp(
      [
        "-f",
        "bestaudio[ext=m4a]/bestaudio/best",
        "-g",
        "--no-playlist",
        "--no-warnings",
        videoUrl,
      ],
      { timeoutMs: 45_000 }
    );

    const directUrl = String(stdout).trim().split(/\r?\n/).filter(Boolean)[0];
    if (!directUrl) throw new Error("yt-dlp returned no stream URL");

    const abortController = new AbortController();
    req.on("close", () => {
      try {
        abortController.abort();
      } catch {}
    });

    const upstreamHeaders = {};
    if (req.headers.range) upstreamHeaders.Range = req.headers.range;

    const upstream = await fetch(directUrl, {
      method: "GET",
      headers: upstreamHeaders,
      redirect: "follow",
      signal: abortController.signal,
    });

    res.status(upstream.status);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Accept-Ranges",
      upstream.headers.get("accept-ranges") || "bytes"
    );

    const contentType = upstream.headers.get("content-type");
    if (contentType) res.setHeader("Content-Type", contentType);

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
      if (abortController.signal.aborted || err?.name === "AbortError") return;
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
      if (abortController.signal.aborted || err?.name === "AbortError") return;
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

// HEAD request for stream endpoint
app.head("/api/stream/:videoId", async (req, res) => {
  const videoId = normalizeVideoId(req.params.videoId);

  if (!videoId) {
    return res.status(400).end();
  }

  log(`HEAD request for: ${videoId}`);

  try {
    const videoUrl = toYouTubeWatchUrl(videoId);
    const { stdout } = await runYtDlp(
      [
        "-f",
        "bestaudio[ext=m4a]/bestaudio/best",
        "-g",
        "--no-playlist",
        "--no-warnings",
        videoUrl,
      ],
      { timeoutMs: 45_000 }
    );

    const directUrl = String(stdout).trim().split(/\r?\n/).filter(Boolean)[0];
    if (!directUrl) throw new Error("yt-dlp returned no stream URL");

    const upstream = await fetch(directUrl, {
      method: "HEAD",
      redirect: "follow",
    });
    const contentType = upstream.headers.get("content-type");
    const contentLength = upstream.headers.get("content-length");

    if (contentType) res.setHeader("Content-Type", contentType);
    if (contentLength) res.setHeader("Content-Length", contentLength);
    res.setHeader(
      "Accept-Ranges",
      upstream.headers.get("accept-ranges") || "bytes"
    );
    res.setHeader("Cache-Control", "no-store");

    res.status(upstream.ok ? 200 : upstream.status).end();
    log(`HEAD request successful for: ${videoId}`);
  } catch (error) {
    logError(`HEAD request failed for: ${videoId}`, error);
    res.status(500).end();
  }
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
app.listen(port, () => {
  log(`🚀 API listening on http://localhost:${port}`);
  log(`Health check: http://localhost:${port}/api/health`);
  log(`Environment: ${process.env.NODE_ENV || "development"}`);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  logError("Unhandled Rejection at:", { promise, reason });
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  logError("Uncaught Exception:", error);
  process.exit(1);
});
