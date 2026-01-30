import ytdl from "@distube/ytdl-core";
import cors from "cors";
import express from "express";
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

const ytdlRequestOptions = {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
  },
};

function pickAudioFormat(formats) {
  try {
    if (!Array.isArray(formats) || formats.length === 0) {
      throw new Error("No formats available");
    }

    const audioFormats = ytdl.filterFormats(formats, "audioonly");
    log(`Found ${audioFormats.length} audio-only formats`);

    if (audioFormats.length === 0) {
      throw new Error("No audio-only formats found");
    }

    const nonSegmented = audioFormats.filter((f) => !f.isHLS && !f.isDashMPD);
    const withLength = nonSegmented.filter((f) => f.contentLength);

    const preferredPool =
      withLength.length > 0
        ? withLength
        : nonSegmented.length > 0
        ? nonSegmented
        : audioFormats;

    const mp4Audio = preferredPool.filter((f) =>
      String(f.mimeType ?? "").startsWith("audio/mp4")
    );
    const pool = mp4Audio.length > 0 ? mp4Audio : preferredPool;

    const sorted = pool
      .slice()
      .sort(
        (a, b) =>
          (Number(b.audioBitrate ?? b.bitrate ?? 0) || 0) -
          (Number(a.audioBitrate ?? a.bitrate ?? 0) || 0)
      );

    const selected = sorted[0];
    
    if (!selected) {
      throw new Error("No suitable format after filtering");
    }

    log(`Selected format: ${selected.mimeType} @ ${selected.audioBitrate || selected.bitrate}kbps`);
    return selected;
  } catch (error) {
    logError("Error in pickAudioFormat", error);
    throw error;
  }
}

function normalizeVideoId(videoIdOrUrl) {
  try {
    if (!videoIdOrUrl) return null;
    
    const cleaned = String(videoIdOrUrl).trim();
    
    if (ytdl.validateID(cleaned)) {
      log(`Valid video ID: ${cleaned}`);
      return cleaned;
    }
    
    const extracted = ytdl.getURLVideoID(cleaned);
    log(`Extracted video ID from URL: ${extracted}`);
    return extracted;
  } catch (error) {
    logError(`Invalid video ID/URL: ${videoIdOrUrl}`, error);
    return null;
  }
}

function pickBestThumbnail(thumbnails = []) {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) return "";
  return (
    thumbnails.reduce(
      (best, t) => (t.width > (best?.width ?? 0) ? t : best),
      thumbnails[0]
    )?.url ?? ""
  );
}

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    service: "YouTube Audio Player API"
  });
});

// Get video info endpoint
app.get("/api/info/:videoId", async (req, res) => {
  const videoId = normalizeVideoId(req.params.videoId);
  
  if (!videoId) {
    log(`Invalid videoId received: ${req.params.videoId}`);
    return res.status(400).json({ 
      error: "Invalid video ID",
      videoId: req.params.videoId 
    });
  }

  log(`Fetching info for video: ${videoId}`);

  try {
    const info = await ytdl.getInfo(videoId, {
      requestOptions: ytdlRequestOptions,
      playerClients: ["ANDROID", "WEB"],
    });

    const { videoDetails } = info;

    if (!videoDetails) {
      throw new Error("No video details found");
    }

    const response = {
      videoId: videoDetails.videoId,
      title: videoDetails.title || "Unknown Title",
      channelName: videoDetails.author?.name || videoDetails.ownerChannelName || "Unknown Channel",
      thumbnail: pickBestThumbnail(videoDetails.thumbnails),
      duration: Number.parseInt(videoDetails.lengthSeconds ?? "0", 10) || 0,
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
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
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
      query 
    });
  }
});

// Stream audio endpoint - ENHANCED VERSION
app.get("/api/stream/:videoId", async (req, res) => {
  const videoId = normalizeVideoId(req.params.videoId);
  
  if (!videoId) {
    log(`Invalid videoId received for streaming: ${req.params.videoId}`);
    return res.status(400).json({ 
      error: "Invalid video ID",
      videoId: req.params.videoId 
    });
  }

  log(`========================================`);
  log(`Streaming request for video: ${videoId}`);
  log(`Request headers:`, req.headers);

  let info;
  let format;

  try {
    // Get video info with timeout
    log(`Fetching video info...`);
    info = await Promise.race([
      ytdl.getInfo(videoId, {
        requestOptions: ytdlRequestOptions,
        playerClients: ["ANDROID", "WEB"],
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Info fetch timeout")), 30000)
      )
    ]);

    log(`✓ Video info fetched: ${info.videoDetails.title}`);
    log(`Available formats: ${info.formats.length}`);

    // Pick best audio format
    log(`Selecting audio format...`);
    format = pickAudioFormat(info.formats);
    
    if (!format || !format.url) {
      throw new Error("No suitable audio format found or format URL is missing");
    }

    log(`✓ Format selected:`, {
      itag: format.itag,
      mimeType: format.mimeType,
      bitrate: format.audioBitrate || format.bitrate,
      contentLength: format.contentLength,
      hasUrl: !!format.url
    });

    const mimeType = String(format.mimeType ?? "audio/mpeg").split(";")[0];
    const totalSize = format.contentLength ? Number(format.contentLength) : null;

    // Set response headers - IMPORTANT: Set headers before any response
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Accept-Ranges", "none");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Range");
    
    if (totalSize && Number.isFinite(totalSize)) {
      res.setHeader("Content-Length", String(totalSize));
      log(`Content-Length set: ${totalSize} bytes`);
    }

    log(`Starting stream...`);

    // Create download stream with error handling
    const stream = ytdl.downloadFromInfo(info, { 
      format, 
      requestOptions: ytdlRequestOptions,
      highWaterMark: 1024 * 512 // 512KB buffer
    });

    let streamStarted = false;
    let bytesStreamed = 0;

    stream.on("response", (response) => {
      log(`✓ Stream response received:`, {
        statusCode: response.statusCode,
        headers: response.headers
      });
    });

    stream.on("data", (chunk) => {
      if (!streamStarted) {
        log(`✓ First chunk received, streaming started`);
        streamStarted = true;
      }
      bytesStreamed += chunk.length;
    });

    stream.on("error", (err) => {
      logError("Stream error occurred", err);
      if (!res.headersSent) {
        res.status(500).json({ 
          error: "Stream error",
          message: err.message,
          videoId
        });
      } else {
        // Headers already sent, just end the response
        res.end();
      }
    });

    stream.on("end", () => {
      log(`✓ Stream completed successfully: ${videoId}`);
      log(`Total bytes streamed: ${bytesStreamed}`);
    });

    // Handle client disconnect
    req.on("close", () => {
      log(`Client disconnected: ${videoId}`);
      stream.destroy();
    });

    req.on("error", (err) => {
      logError("Request error", err);
      stream.destroy();
    });

    // Pipe the stream to response
    stream.pipe(res);

  } catch (error) {
    logError(`❌ Failed to stream video: ${videoId}`, error);
    
    if (!res.headersSent) {
      const errorMessage = error.message || "Failed to stream audio";
      const statusCode = errorMessage.includes("unavailable") ? 404 : 
                         errorMessage.includes("timeout") ? 504 : 500;
      
      return res.status(statusCode).json({ 
        error: errorMessage,
        videoId,
        suggestion: "This video may be restricted, unavailable, or require age verification.",
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        formatInfo: format ? {
          itag: format.itag,
          mimeType: format.mimeType,
          hasUrl: !!format.url
        } : null
      });
    }
  }
});

// HEAD request for stream endpoint (for preflight checks)
app.head("/api/stream/:videoId", async (req, res) => {
  const videoId = normalizeVideoId(req.params.videoId);
  
  if (!videoId) {
    return res.status(400).end();
  }

  log(`HEAD request for: ${videoId}`);

  try {
    const info = await ytdl.getInfo(videoId, {
      requestOptions: ytdlRequestOptions,
      playerClients: ["ANDROID", "WEB"],
    });

    const format = pickAudioFormat(info.formats);
    
    if (!format || !format.url) {
      throw new Error("No suitable format");
    }

    const mimeType = String(format.mimeType ?? "audio/mpeg").split(";")[0];
    const totalSize = format.contentLength ? Number(format.contentLength) : null;

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Accept-Ranges", "none");
    res.setHeader("Access-Control-Allow-Origin", "*");
    
    if (totalSize && Number.isFinite(totalSize)) {
      res.setHeader("Content-Length", String(totalSize));
    }

    res.status(200).end();
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
      "HEAD /api/stream/:videoId"
    ]
  });
});

// Global error handler
app.use((err, req, res, next) => {
  logError("Unhandled error", err);
  
  if (!res.headersSent) {
    res.status(500).json({ 
      error: "Internal server error",
      message: err.message,
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  } else {
    res.end();
  }
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  log(`🚀 API listening on http://localhost:${port}`);
  log(`Health check: http://localhost:${port}/api/health`);
  log(`Environment: ${process.env.NODE_ENV || 'development'}`);
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