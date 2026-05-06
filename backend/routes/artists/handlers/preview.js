import { UUID_REGEX } from "../../../config/constants.js";
import {
  deezerGetArtistTopTracks,
  deezerGetArtistTopTracksById,
} from "../../../services/apiClients.js";
import { dbOps } from "../../../config/db-helpers.js";
import { cacheMiddleware } from "../../../middleware/cache.js";

export default function registerPreview(router) {
  router.get("/:mbid/preview", cacheMiddleware(60), async (req, res) => {
    try {
      const { mbid } = req.params;
      const artistNameParam = (req.query.artistName || "").trim();
      if (!UUID_REGEX.test(mbid)) {
        return res.status(400).json({ error: "Invalid MBID format", tracks: [] });
      }
      const override = dbOps.getArtistOverride(mbid);
      const resolvedMbid = override?.musicbrainzId || mbid;
      const deezerArtistId = override?.deezerArtistId || null;

      if (deezerArtistId) {
        const tracks = await deezerGetArtistTopTracksById(deezerArtistId);
        return res.json({ tracks });
      }
      const artistName = artistNameParam || null;
      if (!artistName) {
        return res.json({ tracks: [] });
      }
      const normalized =
        artistName.replace(/\s*\([^)]*\)\s*$/, "").trim() || artistName;
      const tracks = await deezerGetArtistTopTracks(normalized);
      res.json({ tracks });
    } catch (error) {
      res.json({ tracks: [] });
    }
  });
}
