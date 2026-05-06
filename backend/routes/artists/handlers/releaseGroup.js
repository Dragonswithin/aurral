import { UUID_REGEX } from "../../../config/constants.js";
import {
  fetchCoverArtArchiveReleaseGroup,
  musicbrainzRequest,
} from "../../../services/apiClients.js";
import { dbOps } from "../../../config/db-helpers.js";
import { cacheMiddleware } from "../../../middleware/cache.js";
import { buildImageProxyUrl } from "../../../services/imageProxyService.js";

export default function registerReleaseGroup(router) {
  router.get("/release-group/:mbid/cover", cacheMiddleware(86400), async (req, res) => {
    try {
      const { mbid } = req.params;

      if (!UUID_REGEX.test(mbid)) {
        return res.status(400).json({ error: "Invalid MBID format", images: [] });
      }

      const cacheKey = `rg:${mbid}`;
      const cachedImage = dbOps.getImage(cacheKey);

      if (
        cachedImage &&
        cachedImage.imageUrl &&
        cachedImage.imageUrl !== "NOT_FOUND"
      ) {
        const cachedUrl =
          buildImageProxyUrl(cachedImage.imageUrl) || cachedImage.imageUrl;
        res.set("Cache-Control", "public, max-age=31536000, immutable");
        return res.json({
          images: [
            {
              image: cachedUrl,
              front: true,
              types: ["Front"],
            },
          ],
        });
      }

      if (cachedImage && cachedImage.imageUrl === "NOT_FOUND") {
        res.set("Cache-Control", "public, max-age=3600");
        return res.json({ images: [] });
      }

      try {
        const cover = await fetchCoverArtArchiveReleaseGroup(mbid);
        if (cover?.imageUrl) {
          dbOps.setImage(cacheKey, cover.imageUrl);
          const proxiedCoverUrl =
            buildImageProxyUrl(cover.imageUrl) || cover.imageUrl;

          res.set("Cache-Control", "public, max-age=31536000, immutable");
          return res.json({
            images: [
              {
                image: proxiedCoverUrl,
                front: true,
                types: cover.types,
              },
            ],
          });
        }
      } catch (e) {}

      dbOps.setImage(cacheKey, "NOT_FOUND");
      res.set("Cache-Control", "public, max-age=3600");
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

      const rgData = await musicbrainzRequest(`/release-group/${mbid}`, {
        inc: "releases",
      });

      if (!rgData.releases || rgData.releases.length === 0) {
        return res.json([]);
      }

      const releaseId = rgData.releases[0].id;
      const releaseData = await musicbrainzRequest(`/release/${releaseId}`, {
        inc: "recordings",
      });

      const tracks = [];
      if (releaseData.media && releaseData.media.length > 0) {
        for (const medium of releaseData.media) {
          if (medium.tracks) {
            for (const track of medium.tracks) {
              const recording = track.recording;
              if (recording) {
                tracks.push({
                  id: recording.id,
                  mbid: recording.id,
                  title: recording.title,
                  trackName: recording.title,
                  trackNumber: track.position || 0,
                  position: track.position || 0,
                  length: recording.length || null,
                });
              }
            }
          }
        }
      }

      res.json(tracks);
    } catch (error) {
      console.error("Error fetching release group tracks:", error);
      res.status(500).json({
        error: "Failed to fetch tracks",
        message: error.message,
      });
    }
  });
}
