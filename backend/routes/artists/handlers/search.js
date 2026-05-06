import { cacheMiddleware } from "../../../middleware/cache.js";
import { searchArtistsLegacy } from "../../../services/searchService.js";

const handleSearch = async (req, res) => {
  try {
    const { query, limit = 24, offset = 0 } = req.query;

    if (!query) {
      return res.status(400).json({ error: "Query parameter is required" });
    }

    return res.json(await searchArtistsLegacy(query, limit, offset));
  } catch (error) {
    res.status(500).json({
      error: "Failed to search artists",
      message: error.message,
    });
  }
};

export default function registerSearch(router) {
  router.get("/search", cacheMiddleware(300), handleSearch);
  router.get("/artists", cacheMiddleware(300), handleSearch);
}
