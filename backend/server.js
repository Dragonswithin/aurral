import "./loadEnv.js";

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createServer } from "http";

process.on("uncaughtException", (err) => {
  if (err.code === "ERR_STREAM_DESTROYED") {
    console.warn(
      "[Process] Caught stream destroyed error (safe to ignore):",
      err.message,
    );
    return;
  }
  console.error("[Process] Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  if (reason?.code === "ERR_STREAM_DESTROYED") {
    console.warn(
      "[Process] Caught stream destroyed rejection (safe to ignore)",
    );
    return;
  }
  console.error("[Process] Unhandled Rejection:", reason);
});

import { createAuthMiddleware } from "./middleware/auth.js";
import {
  updateDiscoveryCache,
  getDiscoveryCache,
} from "./services/discoveryService.js";
import { websocketService } from "./services/websocketService.js";
import { getAllDownloadStatuses } from "./routes/library/handlers/downloads.js";

import settingsRouter from "./routes/settings.js";
import onboardingRouter from "./routes/onboarding.js";
import usersRouter from "./routes/users.js";
import artistsRouter from "./routes/artists.js";
import searchRouter from "./routes/search.js";
import libraryRouter from "./routes/library.js";
import discoveryRouter from "./routes/discovery.js";
import requestsRouter from "./routes/requests.js";
import healthRouter from "./routes/health.js";
import weeklyFlowRouter from "./routes/weeklyFlow.js";
import imageProxyRouter from "./routes/imageProxy.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

const allowedCorsOrigins = String(process.env.CORS_ORIGIN || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

const corsOptions =
  allowedCorsOrigins.length > 0
    ? {
        origin(origin, callback) {
          if (!origin || allowedCorsOrigins.includes(origin)) {
            return callback(null, true);
          }
          return callback(null, false);
        },
      }
    : { origin: false };

const trustProxyValue =
  process.env.TRUST_PROXY === undefined
    ? 1
    : process.env.TRUST_PROXY === "true"
      ? true
      : process.env.TRUST_PROXY === "false"
        ? false
        : Number.isNaN(Number(process.env.TRUST_PROXY))
          ? process.env.TRUST_PROXY
          : Number(process.env.TRUST_PROXY);
app.set("trust proxy", trustProxyValue);

app.use(cors(corsOptions));
app.use(helmet());
app.use(express.json());

app.use(createAuthMiddleware());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,
});
app.use("/api/", limiter);

app.use("/api/settings", settingsRouter);
app.use("/api/onboarding", onboardingRouter);
app.use("/api/users", usersRouter);
app.use("/api/search", searchRouter);
app.use("/api/artists", artistsRouter);
app.use("/api/library", libraryRouter);
app.use("/api/discover", discoveryRouter);
app.use("/api/requests", requestsRouter);
app.use("/api/health", healthRouter);
app.use("/api/weekly-flow", weeklyFlowRouter);
app.use("/api/image-proxy", imageProxyRouter);

setInterval(updateDiscoveryCache, 24 * 60 * 60 * 1000);

setTimeout(async () => {
  const { dbOps } = await import("./config/db-helpers.js");
  const discovery = dbOps.getDiscoveryCache();
  const lastUpdated = discovery?.lastUpdated;
  const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
  if (!lastUpdated || new Date(lastUpdated).getTime() < twentyFourHoursAgo) {
    updateDiscoveryCache();
  } else {
    console.log(
      `Discovery cache is fresh (last updated ${lastUpdated}). Skipping initial update.`,
    );
  }
}, 5000);

const httpServer = createServer(app);

websocketService.initialize(httpServer);

const DOWNLOAD_STATUS_INTERVAL_MS = 10000;
let lastDownloadStatusesPayload = null;
const broadcastDownloadStatuses = async () => {
  try {
    const statuses = await getAllDownloadStatuses();
    const payload = JSON.stringify(statuses);
    if (payload !== lastDownloadStatusesPayload) {
      lastDownloadStatusesPayload = payload;
      websocketService.broadcast("downloads", {
        type: "download_statuses",
        statuses,
      });
    }
  } catch (error) {
    console.warn("Failed to broadcast download statuses:", error.message);
  }
};

broadcastDownloadStatuses();
setInterval(broadcastDownloadStatuses, DOWNLOAD_STATUS_INTERVAL_MS);

httpServer.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket available at ws://localhost:${PORT}/ws`);
});
