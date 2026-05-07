import express from "express";
import {
  handleImageProxyRequest,
  handleLegacyImageProxyRequest,
} from "../services/imageProxyService.js";

const router = express.Router();

router.get("/", handleLegacyImageProxyRequest);
router.get("/:cacheKey", handleImageProxyRequest);

export default router;
