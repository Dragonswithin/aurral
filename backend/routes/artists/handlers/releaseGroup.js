import { UUID_REGEX } from "../../../config/constants.js";
import { dbOps } from "../../../config/db-helpers.js";
import { cacheMiddleware } from "../../../middleware/cache.js";
import { warmImageProxy } from "../../../services/imageProxyService.js";
import {
  getAlbumByMbid,
  getAlbumTracksByAlbumMbid,
} from "../../../services/metadataProvider.js";

const LEGACY_COVER_HOST_PATTERN =
  /https?:\/\/(?:caa\.lkly\.net|coverartarchive\.org|archive\.org|[\w-]+\.ca\.archive\.org)\//i;

export default function registerReleaseGroup(router) {
  router.get("/release-group/:mbid/cover", cacheMiddleware(86400), async (req, res) => {
    try {
      const { mbid } = req.params;
      const artistName =
        typeof req.query.artistName === "string" && req.query.artistName.trim()
          ? req.query.artistName.trim()
          : "";
      const albumTitleFromQuery =
        typeof req.query.albumTitle === "string" && req.query.albumTitle.trim()
          ? req.query.albumTitle.trim()
          : "";

      if (!UUID_REGEX.test(mbid)) {
        return res.status(400).json({ error: "Invalid MBID format", images: [] });
      }

      const cacheKey = `rg:${mbid}`;
      const cachedImage = dbOps.getImage(cacheKey);

      if (
        cachedImage &&
        cachedImage.imageUrl &&
        cachedImage.imageUrl !== "NOT_FOUND" &&
        !LEGACY_COVER_HOST_PATTERN.test(cachedImage.imageUrl)
      ) {
        warmImageProxy(cachedImage.imageUrl).catch(() => {
          dbOps.deleteImage(cacheKey);
        });
        res.set("Cache-Control", "public, max-age=31536000, immutable");
        return res.json({
          images: [
            {
              image: cachedImage.imageUrl,
              front: true,
              types: ["Front"],
            },
          ],
        });
      }

      if (
        cachedImage &&
        cachedImage.imageUrl &&
        cachedImage.imageUrl !== "NOT_FOUND" &&
        LEGACY_COVER_HOST_PATTERN.test(cachedImage.imageUrl)
      ) {
        dbOps.deleteImage(cacheKey);
      }

      if (cachedImage && cachedImage.imageUrl === "NOT_FOUND") {
        res.set("Cache-Control", "public, max-age=3600");
        return res.json({ images: [] });
      }

      try {
        const album = await getAlbumByMbid(mbid);
        const image = Array.isArray(album?.images) ? album.images[0] : null;
        if (image?.url) {
          const cachedImage = await warmImageProxy(image.url);
          dbOps.setImage(cacheKey, cachedImage.localUrl);
          res.set("Cache-Control", "public, max-age=31536000, immutable");
          return res.json({
            images: [
              {
                image: cachedImage.localUrl,
                front: true,
                types: [image.kind || "Front"],
              },
            ],
          });
        }
        dbOps.setImage(cacheKey, "NOT_FOUND");
        res.set("Cache-Control", "public, max-age=3600");
        return res.json({ images: [] });
      } catch (e) {}

      res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
      res.json({ images: [] });
    } catch (error) {
      console.error(
        `Error in release-group cover route for ${req.params.mbid}:`,
        error.message
      );
      res.set("Cache-Control", "public, max-age=60");
      res.json({ images: [] });
    }
  });

  router.get("/release-group/:mbid/tracks", cacheMiddleware(86400), async (req, res) => {
    try {
      const { mbid } = req.params;
      if (!UUID_REGEX.test(mbid)) {
        return res.status(400).json({ error: "Invalid MBID format" });
      }

      const tracks = await getAlbumTracksByAlbumMbid(mbid);
      res.json(
        tracks.map((track) => ({
          id: track.recordingId || track.id,
          mbid: track.recordingId || track.id,
          title: track.title,
          trackName: track.title,
          trackNumber: track.trackPosition || track.trackNumber || 0,
          position: track.trackPosition || track.trackNumber || 0,
          length: track.durationMs || null,
        })),
      );
    } catch (error) {
      console.error("Error fetching release group tracks:", error);
      res.status(500).json({
        error: "Failed to fetch tracks",
        message: error.message,
      });
    }
  });
}
