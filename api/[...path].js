import cors from "cors";
import express from "express";
import yts from "yt-search";

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

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "YouTube Audio Player API",
    environment: process.env.VERCEL ? "vercel" : "local",
  });
});

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

    const response = videos
      .filter((v) => v?.videoId)
      .slice(0, 10)
      .map((v) => ({
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

app.use((req, res) => {
  log(`404 - Route not found: ${req.method} ${req.path}`);
  res.status(404).json({
    error: "Route not found",
    path: req.path,
    availableEndpoints: ["GET /api/health", "GET /api/search?q=query"],
  });
});

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

if (!process.env.VERCEL) {
  const port = Number(process.env.PORT ?? 3002);
  app.listen(port, () => {
    log(`🚀 API listening on http://localhost:${port}`);
    log(`Health check: http://localhost:${port}/api/health`);
    log(`Environment: ${process.env.NODE_ENV || "development"}`);
  });
}

export default app;
