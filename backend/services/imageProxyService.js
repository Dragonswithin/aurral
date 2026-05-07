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
const FETCH_TIMEOUT_MS = 25000;
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

const normalizeKnownImageUrl = (value) =>
  String(value || "")
    .trim()
    .replace(
      /^(https?:\/\/(?:caa\.lkly\.net|coverartarchive\.org)\/release-group\/[0-9a-f-]+)\/front-250(?=[/?#]|$)/i,
      "$1/front",
    )
    .replace(
      /^(https?:\/\/(?:[\w-]+\.)?ca\.archive\.org\/.*?)-thumb250(\.[a-z0-9]+)(?=[?#]|$)/i,
      "$1$2",
    )
    .replace(
      /^(https?:\/\/archive\.org\/download\/[^?#]+?)_thumb250(\.[a-z0-9]+)(?=[?#]|$)/i,
      "$1$2",
    );

const getCachePaths = (cacheKey) => ({
  metaPath: path.join(IMAGE_PROXY_DIR, `${cacheKey}.json`),
  baseImagePath: path.join(IMAGE_PROXY_DIR, `${cacheKey}`),
});

const buildLocalImageUrl = (cacheKey, extension) =>
  `${IMAGE_PROXY_ROUTE}/${cacheKey}.${extension}`;

const getCacheKeyFromLocalUrl = (value) => {
  const normalized = String(value || "").trim();
  const match = normalized.match(/\/api\/image-proxy\/([a-f0-9]{64})(?:\.[a-z0-9]+)?$/i);
  return match?.[1]?.toLowerCase() || null;
};

const readCacheMetadata = (metaPath) => {
  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch {
    return null;
  }
};

const getCachedEntryFromKey = (cacheKey) => {
  if (!cacheKey) return null;
  const { metaPath, baseImagePath } = getCachePaths(cacheKey);
  const meta = readCacheMetadata(metaPath);
  if (!meta?.extension) return null;

  const imagePath = `${baseImagePath}.${meta.extension}`;
  if (!fs.existsSync(imagePath)) return null;

  return {
    cacheKey,
    meta,
    imagePath,
    localUrl: buildLocalImageUrl(cacheKey, meta.extension),
    isFresh:
      Number(meta.fetchedAt || 0) > 0 &&
      Date.now() - Number(meta.fetchedAt || 0) < CACHE_TTL_MS,
  };
};

const getCachedEntry = (sourceUrl) => {
  const normalizedSourceUrl = normalizeKnownImageUrl(sourceUrl);
  if (!normalizedSourceUrl) return null;
  return getCachedEntryFromKey(hashValue(normalizedSourceUrl));
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
    cacheKey,
    meta,
    imagePath,
    localUrl: buildLocalImageUrl(cacheKey, extension),
    isFresh: true,
  };
};

const fetchAndCacheImage = async (sourceUrl) => {
  const normalizedSourceUrl = normalizeKnownImageUrl(sourceUrl);
  if (!normalizedSourceUrl) {
    throw new Error("Missing source image URL");
  }

  const parsed = new URL(normalizedSourceUrl);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Unsupported image protocol");
  }
  if (isPrivateHostname(parsed.hostname)) {
    throw new Error("Refusing to cache private host");
  }

  const response = await axios.get(normalizedSourceUrl, {
    responseType: "arraybuffer",
    timeout: FETCH_TIMEOUT_MS,
    maxRedirects: 10,
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "User-Agent": "Aurral Local Image Cache",
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
    hashValue(normalizedSourceUrl),
    Buffer.from(response.data),
    contentType,
    normalizedSourceUrl,
  );
};

export const warmImageProxy = async (sourceUrl) => {
  const cacheKeyFromLocalUrl = getCacheKeyFromLocalUrl(sourceUrl);
  if (cacheKeyFromLocalUrl) {
    const cachedLocal = getCachedEntryFromKey(cacheKeyFromLocalUrl);
    if (cachedLocal?.imagePath) {
      return cachedLocal;
    }
    throw new Error("Missing local cached image");
  }

  const normalizedSourceUrl = normalizeKnownImageUrl(sourceUrl);
  if (!normalizedSourceUrl) {
    throw new Error("Missing source image URL");
  }

  const cached = getCachedEntry(normalizedSourceUrl);
  if (cached?.isFresh) {
    return cached;
  }

  if (inflightRequests.has(normalizedSourceUrl)) {
    return inflightRequests.get(normalizedSourceUrl);
  }

  const request = fetchAndCacheImage(normalizedSourceUrl).finally(() => {
    inflightRequests.delete(normalizedSourceUrl);
  });
  inflightRequests.set(normalizedSourceUrl, request);
  return request;
};

export const buildImageProxyUrl = (sourceUrl) => {
  const normalized = normalizeKnownImageUrl(sourceUrl);
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

  const cached = getCachedEntry(normalized);
  return cached?.localUrl || null;
};

export const handleImageProxyRequest = async (req, res) => {
  const rawKey = String(req.params.cacheKey || "").trim();
  const match = rawKey.match(/^([a-f0-9]{64})(?:\.([a-z0-9]+))?$/i);
  if (!match) {
    return res.status(404).json({ error: "Image not found" });
  }

  const cacheKey = match[1].toLowerCase();
  const cached = getCachedEntryFromKey(cacheKey);
  if (!cached?.imagePath) {
    return res.status(404).json({ error: "Image not found" });
  }

  res.set("Content-Type", cached.meta.contentType || "image/jpeg");
  res.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
  return res.sendFile(cached.imagePath);
};
