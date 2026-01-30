import cors from "cors";
import express from "express";
import yts from "yt-search";
import ytdl from "ytdl-core";

const app = express();
app.use(cors());

const ytdlRequestOptions = {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
  },
};

function normalizeVideoId(videoIdOrUrl) {
  if (ytdl.validateID(videoIdOrUrl)) return videoIdOrUrl;
  try {
    return ytdl.getURLVideoID(videoIdOrUrl);
  } catch {
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

function parseRangeHeader(rangeHeader, totalSize) {
  const match = /^bytes=(\d+)-(\d*)$/i.exec(rangeHeader ?? "");
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : totalSize - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start >= totalSize) return null;
  const safeEnd = Math.min(end, totalSize - 1);
  if (safeEnd < start) return null;
  return { start, end: safeEnd };
}

app.get("/api/info/:videoId", async (req, res) => {
  try {
    const videoId = normalizeVideoId(req.params.videoId);
    if (!videoId) return res.status(400).json({ error: "Invalid videoId" });

    const info = await ytdl.getInfo(videoId, {
      requestOptions: ytdlRequestOptions,
    });
    const { videoDetails } = info;

    return res.json({
      videoId: videoDetails.videoId,
      title: videoDetails.title,
      channelName: videoDetails.author?.name ?? "",
      thumbnail: pickBestThumbnail(videoDetails.thumbnails),
      duration: Number.parseInt(videoDetails.lengthSeconds ?? "0", 10) || 0,
    });
  } catch (error) {
    process.stderr.write(`${error?.stack ?? error}\n`);
    return res.status(500).json({ error: "Failed to fetch video info" });
  }
});

app.get("/api/search", async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.json([]);

    const result = await yts(q);
    const videos = Array.isArray(result?.videos) ? result.videos : [];

    return res.json(
      videos.slice(0, 10).map((v) => ({
        videoId: v.videoId,
        title: v.title,
        thumbnail: v.thumbnail,
        channelName: v.author?.name ?? v.author ?? "",
      }))
    );
  } catch (error) {
    return res.status(500).json({ error: "Search failed" });
  }
});

app.get("/api/stream/:videoId", async (req, res) => {
  try {
    const videoId = normalizeVideoId(req.params.videoId);
    if (!videoId) return res.status(400).json({ error: "Invalid videoId" });

    const info = await ytdl.getInfo(videoId, {
      requestOptions: ytdlRequestOptions,
    });
    const format = ytdl.chooseFormat(info.formats, {
      quality: "highestaudio",
      filter: "audioonly",
    });

    const mimeType = String(format?.mimeType ?? "audio/mpeg").split(";")[0];
    const totalSize = format?.contentLength
      ? Number(format.contentLength)
      : null;

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    const rangeHeader = req.headers.range;
    if (rangeHeader && totalSize && Number.isFinite(totalSize)) {
      const range = parseRangeHeader(rangeHeader, totalSize);
      if (range) {
        res.status(206);
        res.setHeader(
          "Content-Range",
          `bytes ${range.start}-${range.end}/${totalSize}`
        );
        res.setHeader("Content-Length", String(range.end - range.start + 1));

        ytdl
          .downloadFromInfo(info, {
            format,
            range: { start: range.start, end: range.end },
            requestOptions: ytdlRequestOptions,
          })
          .on("error", () => {
            if (!res.headersSent) res.status(500).end();
          })
          .pipe(res);
        return;
      }
    }

    if (totalSize && Number.isFinite(totalSize)) {
      res.setHeader("Content-Length", String(totalSize));
    }

    ytdl
      .downloadFromInfo(info, { format, requestOptions: ytdlRequestOptions })
      .on("error", () => {
        if (!res.headersSent) res.status(500).end();
      })
      .pipe(res);
  } catch (error) {
    process.stderr.write(`${error?.stack ?? error}\n`);
    return res.status(500).json({ error: "Failed to stream audio" });
  }
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  process.stdout.write(`API listening on http://localhost:${port}\n`);
});
