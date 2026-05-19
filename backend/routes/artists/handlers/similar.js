import { UUID_REGEX } from "../../../config/constants.js";
import {
  getLastfmApiKey,
  lastfmRequest,
  musicbrainzGetArtistNameByMbid,
} from "../../../services/apiClients.js";
import { dbOps } from "../../../config/db-helpers.js";
import { cacheMiddleware } from "../../../middleware/cache.js";
import { buildImageProxyUrl } from "../../../services/imageProxyService.js";

export default function registerSimilar(router) {
  router.get("/:mbid/similar", cacheMiddleware(300), async (req, res) => {
    try {
      const { mbid } = req.params;

      if (!UUID_REGEX.test(mbid)) {
        return res.status(400).json({ error: "Invalid MBID format" });
      }

      const { limit = 10 } = req.query;
      const artistNameParam = String(req.query.artistName || "").trim();

      if (!getLastfmApiKey()) {
        return res.json({ artists: [] });
      }

      const limitInt = Math.min(Math.max(parseInt(limit, 10) || 7, 1), 20);
      const override = dbOps.getArtistOverride(mbid);
      const resolvedMbid = override?.musicbrainzId || mbid;
      let data = await lastfmRequest("artist.getSimilar", {
        mbid: resolvedMbid,
        limit: limitInt,
      });

      if (!data?.similarartists?.artist) {
        const fallbackArtistName =
          artistNameParam ||
          (await musicbrainzGetArtistNameByMbid(resolvedMbid).catch(() => null)) ||
          "";

        if (fallbackArtistName) {
          data = await lastfmRequest("artist.getSimilar", {
            artist: fallbackArtistName,
            limit: limitInt,
          });
        }
      }

      if (!data?.similarartists?.artist) {
        return res.json({ artists: [] });
      }

      const artists = Array.isArray(data.similarartists.artist)
        ? data.similarartists.artist
        : [data.similarartists.artist];

      const formattedArtists = artists
        .map((a) => {
          let img = null;
          if (a.image && Array.isArray(a.image)) {
            const i =
              a.image.find((img) => img.size === "extralarge") ||
              a.image.find((img) => img.size === "large");
            if (
              i &&
              i["#text"] &&
              !i["#text"].includes("2a96cbd8b46e442fc41c2b86b821562f")
            )
              img = i["#text"];
          }
          return {
            id: a.mbid,
            name: a.name,
            image: buildImageProxyUrl(img) || img,
            match: Math.round((a.match || 0) * 100),
          };
        })
        .filter((a) => a.id);

      res.json({ artists: formattedArtists });
    } catch (error) {
      res.status(500).json({
        error: "Failed to fetch similar artists",
        message: error.message,
      });
    }
  });
}
