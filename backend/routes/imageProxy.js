import express from "express";
import { handleImageProxyRequest } from "../services/imageProxyService.js";

const router = express.Router();

router.get("/", handleImageProxyRequest);

export default router;
