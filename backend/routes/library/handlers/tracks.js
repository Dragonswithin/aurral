import { libraryManager } from "../../../services/libraryManager.js";
import { cacheMiddleware } from "../../../middleware/cache.js";
import { getAlbumTracksByAlbumMbid } from "../../../services/metadataProvider.js";

export default function registerTracks(router) {
  router.get("/tracks", cacheMiddleware(120), async (req, res) => {
    try {
      const { albumId, releaseGroupMbid } = req.query;

      let tracks = [];

      if (albumId) {
        tracks = await libraryManager.getTracks(albumId);
      }

      if (tracks.length === 0 && releaseGroupMbid) {
        if (String(releaseGroupMbid).startsWith("dz-")) {
          const { deezerGetAlbumTracks } = await import(
            "../../../services/apiClients.js"
          );
          const dzTracks = await deezerGetAlbumTracks(releaseGroupMbid);
          tracks = dzTracks.map((t) => ({
            ...t,
            path: null,
            hasFile: false,
            size: 0,
            quality: null,
            addedAt: new Date().toISOString(),
          }));
        } else {
          try {
            const metadataTracks = await getAlbumTracksByAlbumMbid(releaseGroupMbid);
            if (metadataTracks.length > 0) {
              tracks = metadataTracks.map((track) => ({
                id: track.recordingId || track.id,
                mbid: track.recordingId || track.id,
                trackName: track.title,
                trackNumber: track.trackPosition || track.trackNumber || 0,
                title: track.title,
                path: null,
                hasFile: false,
                size: 0,
                quality: null,
                addedAt: new Date().toISOString(),
              }));
            }
          } catch (mbError) {
            console.warn(
              `[Library] Failed to fetch tracks from metadata provider: ${mbError.message}`
            );
          }
        }
      }

      const formatted = tracks.map((track) => ({
        ...track,
        title: track.trackName || track.title,
        trackNumber: track.trackNumber || 0,
      }));
      res.json(formatted);
    } catch (error) {
      res.status(500).json({
        error: "Failed to fetch tracks",
        message: error.message,
      });
    }
  });
}
