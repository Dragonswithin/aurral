import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IMAGE_PROXY_ROUTE = "/api/image-proxy";
const IMAGE_PROXY_DIR = path.join(__dirname, "..", "data", "image-proxy");
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const inflightRequests = new Map();

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/i,
  /^0:0:0:0:0:0:0:1$/i,
];

const PRIVATE_172_RANGE = /^172\.(1[6-9]|2\d|3[0-1])\./;
const MIME_EXTENSION_MAP = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

const getProxySecret = () =>
  String(
    process.env.IMAGE_PROXY_SECRET ||
      process.env.AUTH_PASSWORD ||
      process.env.CONTACT_EMAIL ||
      "aurral-image-proxy",
  );

const ensureCacheDir = () => {
  fs.mkdirSync(IMAGE_PROXY_DIR, { recursive: true });
};

const isPrivateHostname = (hostname) => {
  const normalized = String(hostname || "").trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.endsWith(".local")) return true;
  if (PRIVATE_172_RANGE.test(normalized)) return true;
  return PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(normalized));
};

const hashValue = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");

const signSourceUrl = (sourceUrl) =>
  crypto
    .createHmac("sha256", getProxySecret())
    .update(String(sourceUrl))
    .digest("hex");

const getCachePaths = (cacheKey) => ({
  metaPath: path.join(IMAGE_PROXY_DIR, `${cacheKey}.json`),
  baseImagePath: path.join(IMAGE_PROXY_DIR, `${cacheKey}`),
});

const readCacheMetadata = (metaPath) => {
  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch {
    return null;
  }
};

const getCachedEntry = (sourceUrl) => {
  const cacheKey = hashValue(sourceUrl);
  const { metaPath, baseImagePath } = getCachePaths(cacheKey);
  const meta = readCacheMetadata(metaPath);
  if (!meta?.extension) return null;

  const imagePath = `${baseImagePath}.${meta.extension}`;
  if (!fs.existsSync(imagePath)) return null;

  return {
    cacheKey,
    meta,
    imagePath,
    isFresh:
      Number(meta.fetchedAt || 0) > 0 &&
      Date.now() - Number(meta.fetchedAt || 0) < CACHE_TTL_MS,
  };
};

const writeCacheEntry = (cacheKey, buffer, contentType, sourceUrl) => {
  ensureCacheDir();
  const extension = MIME_EXTENSION_MAP[contentType] || "img";
  const { metaPath, baseImagePath } = getCachePaths(cacheKey);
  const imagePath = `${baseImagePath}.${extension}`;
  const fetchedAt = Date.now();
  const meta = {
    sourceUrl,
    contentType,
    extension,
    fetchedAt,
    size: buffer.length,
  };

  fs.writeFileSync(imagePath, buffer);
  fs.writeFileSync(metaPath, JSON.stringify(meta));

  return {
    meta,
    imagePath,
    isFresh: true,
  };
};

const fetchAndCacheImage = async (sourceUrl) => {
  const parsed = new URL(sourceUrl);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Unsupported image protocol");
  }
  if (isPrivateHostname(parsed.hostname)) {
    throw new Error("Refusing to proxy private host");
  }

  const response = await axios.get(sourceUrl, {
    responseType: "arraybuffer",
    timeout: FETCH_TIMEOUT_MS,
    maxRedirects: 5,
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "User-Agent": "Aurral Image Proxy",
    },
  });

  const contentType = String(response.headers["content-type"] || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!contentType.startsWith("image/")) {
    throw new Error("Upstream response is not an image");
  }

  return writeCacheEntry(
    hashValue(sourceUrl),
    Buffer.from(response.data),
    contentType,
    sourceUrl,
  );
};

export const buildImageProxyUrl = (sourceUrl) => {
  const normalized = String(sourceUrl || "").trim();
  if (!normalized) return null;
  if (
    normalized.startsWith("/") ||
    normalized.startsWith("data:") ||
    normalized.startsWith("blob:")
  ) {
    return normalized;
  }

  try {
    const parsed = new URL(normalized);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return normalized;
    }
  } catch {
    return normalized;
  }

  const sig = signSourceUrl(normalized);
  return `${IMAGE_PROXY_ROUTE}?src=${encodeURIComponent(normalized)}&sig=${sig}`;
};

export const handleImageProxyRequest = async (req, res) => {
  const sourceUrl = String(req.query.src || "").trim();
  const signature = String(req.query.sig || "").trim();

  if (!sourceUrl || !signature) {
    return res.status(400).json({ error: "Missing source image parameters" });
  }
  if (signature !== signSourceUrl(sourceUrl)) {
    return res.status(403).json({ error: "Invalid image proxy signature" });
  }

  const cached = getCachedEntry(sourceUrl);
  if (cached?.isFresh) {
    res.set("Content-Type", cached.meta.contentType || "image/jpeg");
    res.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
    return res.sendFile(cached.imagePath);
  }

  if (inflightRequests.has(sourceUrl)) {
    try {
      const inflight = await inflightRequests.get(sourceUrl);
      res.set("Content-Type", inflight.meta.contentType || "image/jpeg");
      res.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
      return res.sendFile(inflight.imagePath);
    } catch (error) {
      if (cached?.imagePath) {
        res.set("Content-Type", cached.meta.contentType || "image/jpeg");
        res.set(
          "Cache-Control",
          "public, max-age=300, stale-while-revalidate=86400",
        );
        return res.sendFile(cached.imagePath);
      }
      return res.status(502).json({ error: "Failed to fetch image" });
    }
  }

  const request = fetchAndCacheImage(sourceUrl).finally(() => {
    inflightRequests.delete(sourceUrl);
  });
  inflightRequests.set(sourceUrl, request);

  try {
    const fresh = await request;
    res.set("Content-Type", fresh.meta.contentType || "image/jpeg");
    res.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
    return res.sendFile(fresh.imagePath);
  } catch (error) {
    if (cached?.imagePath) {
      res.set("Content-Type", cached.meta.contentType || "image/jpeg");
      res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=86400");
      return res.sendFile(cached.imagePath);
    }
    console.warn("[Image Proxy] Failed to fetch image:", error.message);
    return res.status(502).json({ error: "Failed to fetch image" });
  }
};
