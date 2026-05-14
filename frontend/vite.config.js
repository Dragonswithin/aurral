import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { cwd } from "process";
import { resolveAppVersion } from "../lib/app-version.js";

const appVersion = resolveAppVersion({
  envValue: globalThis?.process?.env?.VITE_APP_VERSION,
  cwd: process.cwd(),
});
const releaseChannel =
  globalThis?.process?.env?.VITE_RELEASE_CHANNEL || "stable";

const normalizeBasePath = (baseUrl) => {
  const raw = (baseUrl || "/").trim();
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.endsWith("/")
    ? withLeadingSlash
    : `${withLeadingSlash}/`;
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, cwd(), "");
  const basePath = normalizeBasePath(env.VITE_BASE_PATH || "/");
  const isDev = mode === "development";

  return {
    base: isDev ? "/" : basePath,
    define: {
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
      "import.meta.env.VITE_RELEASE_CHANNEL": JSON.stringify(releaseChannel),
    },
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["arralogo.svg", "icons/*.png"],
        workbox: {
          // SPA fallback must not intercept reverse-proxy auth callbacks or API routes.
          navigateFallbackDenylist: [/^\/oidc\//, /^\/api\//, /^\/logout$/],
        },
        manifest: {
          name: "Aurral - Artist Request Manager",
          short_name: "Aurral",
          description: "Simple and elegant artist request manager",
          theme_color: "#ffffff",
          background_color: "#ffffff",
          display: "standalone",
          orientation: "portrait",
          start_url: basePath,
          icons: [
            {
              src: `${basePath}icons/aurral-icon-iOS-Default-1024x1024@1x.png`,
              sizes: "1024x1024",
              type: "image/png",
              purpose: "any",
            },
          ],
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
    server: {
      port: 3000,
      proxy: {
        "/api": {
          target: "http://localhost:3001",
          changeOrigin: true,
          secure: false,
          ws: true,
          timeout: 60000,
          proxyTimeout: 60000,
        },
        "/ws": {
          target: "ws://localhost:3001",
          ws: true,
        },
      },
    },
  };
});
