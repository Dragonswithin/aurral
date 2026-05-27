import { useState } from "react";
import {
  RefreshCw,
  Trash2,
  Compass,
  Pencil,
  ChevronDown,
  X,
} from "lucide-react";
import FlipSaveButton from "../../../components/FlipSaveButton";

const AUTO_REFRESH_OPTIONS = [
  { value: 24, label: "Daily" },
  { value: 168, label: "Weekly" },
  { value: 720, label: "Monthly" },
];

const DISCOVERY_MODE_OPTIONS = [
  { value: "safer", label: "Safer" },
  { value: "balanced", label: "Balanced" },
  { value: "deeper", label: "Deeper" },
];

const LASTFM_DISCOVER_BANNER_KEY = "aurral:lastfm-discover-settings-banner";

const readLastfmDiscoverBannerDismissed = () => {
  try {
    return localStorage.getItem(LASTFM_DISCOVER_BANNER_KEY) === "1";
  } catch {
    return false;
  }
};

const formatBytes = (value) => {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
};

export function SettingsDiscoverTab({
  settings,
  updateSettings,
  health,
  hasUnsavedChanges,
  saving,
  handleSaveSettings,
  refreshingDiscovery,
  discoveryProgressMessage,
  clearingCache,
  handleRefreshDiscovery,
  handleClearCache,
}) {
  const [discoverEditing, setDiscoverEditing] = useState(false);
  const [lastfmBannerDismissed, setLastfmBannerDismissed] = useState(
    readLastfmDiscoverBannerDismissed,
  );
  const autoRefreshHours =
    settings.integrations?.lastfm?.discoveryAutoRefreshHours || 168;
  const discoveryMode =
    settings.integrations?.lastfm?.discoveryMode || "balanced";
  const discoveryProvider =
    health?.discovery?.provider === "listenbrainz-fallback"
      ? "ListenBrainz fallback"
      : "Last.fm";
  const isListenBrainzFallback =
    health?.discovery?.provider === "listenbrainz-fallback";
  const showLastfmDiscoverBanner =
    isListenBrainzFallback && !lastfmBannerDismissed;

  return (
    <div className="card animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h2
          className="text-2xl font-bold flex items-center gap-2"
          style={{ color: "#fff" }}
        >
          <Compass className="w-6 h-6" />
          Discover
        </h2>
        <FlipSaveButton
          saving={saving}
          disabled={!hasUnsavedChanges}
          onClick={handleSaveSettings}
        />
      </div>

      <form
        onSubmit={handleSaveSettings}
        className="space-y-6"
        autoComplete="off"
      >
        {showLastfmDiscoverBanner && (
          <div
            className="flex items-start justify-between gap-4 rounded-lg p-4"
            style={{
              backgroundColor: "#211f27",
              border: "1px solid #34313c",
            }}
          >
            <div className="space-y-1">
              <p
                className="text-sm font-semibold uppercase tracking-wide"
                style={{ color: "#fff" }}
              >
                Optional Last.fm upgrade
              </p>
              <p className="text-sm" style={{ color: "#c1c1c3" }}>
                Add a free Last.fm API key in Integrations to unlock personalized
                recommendations, similar artists, tag and genre search, and custom
                weekly flows.
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded p-2 transition-colors hover:bg-white/10"
              style={{ color: "#c1c1c3" }}
              onClick={() => {
                setLastfmBannerDismissed(true);
                try {
                  localStorage.setItem(LASTFM_DISCOVER_BANNER_KEY, "1");
                } catch {}
              }}
              aria-label="Dismiss Last.fm upgrade reminder"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div
          className="p-6 rounded-lg space-y-4"
          style={{
            backgroundColor: "#1a1a1e",
            border: "1px solid #2a2a2e",
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-medium" style={{ color: "#fff" }}>
              Discovery behavior
            </h3>
            <button
              type="button"
              className={`btn ${
                discoverEditing ? "btn-primary" : "btn-secondary"
              } px-2 py-1`}
              onClick={() => setDiscoverEditing((value) => !value)}
              aria-label={
                discoverEditing
                  ? "Lock discovery settings"
                  : "Edit discovery settings"
              }
            >
              <Pencil className="w-4 h-4" />
            </button>
          </div>
          <fieldset
            disabled={!discoverEditing}
            className={`space-y-4 ${discoverEditing ? "" : "opacity-60"}`}
          >
            <div>
              <label
                className="block text-sm font-medium mb-1"
                style={{ color: "#fff" }}
              >
                Auto-refresh frequency
              </label>
              <div className="relative">
                <select
                  className="input h-11 w-full appearance-none pr-14 text-sm text-white"
                  value={String(autoRefreshHours)}
                  onChange={(e) =>
                    updateSettings({
                      ...settings,
                      integrations: {
                        ...settings.integrations,
                        lastfm: {
                          ...(settings.integrations?.lastfm || {}),
                          discoveryAutoRefreshHours: parseInt(
                            e.target.value,
                            10,
                          ),
                        },
                      },
                    })
                  }
                >
                  {AUTO_REFRESH_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#b9bac1]" />
              </div>
            </div>
            {!isListenBrainzFallback && (
              <div>
                <label
                  className="block text-sm font-medium mb-1"
                  style={{ color: "#fff" }}
                >
                  Discovery mode
                </label>
                <div className="relative">
                  <select
                    className="input h-11 w-full appearance-none pr-14 text-sm text-white"
                    value={discoveryMode}
                    onChange={(e) =>
                      updateSettings({
                        ...settings,
                        integrations: {
                          ...settings.integrations,
                          lastfm: {
                            ...(settings.integrations?.lastfm || {}),
                            discoveryMode: e.target.value,
                          },
                        },
                      })
                    }
                  >
                    {DISCOVERY_MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#b9bac1]" />
                </div>
                <div
                  className="mt-3 space-y-1 text-xs"
                  style={{ color: "#c1c1c3" }}
                >
                  <p>
                    <span style={{ color: "#fff" }}>Safer:</span> favors more
                    obvious, high-confidence recommendations.
                  </p>
                  <p>
                    <span style={{ color: "#fff" }}>Balanced:</span> mixes
                    familiar artists with some exploration.
                  </p>
                  <p>
                    <span style={{ color: "#fff" }}>Deeper:</span> pushes
                    further beyond the most obvious similar artists.
                  </p>
                </div>
              </div>
            )}
          </fieldset>
        </div>

        <div
          className="p-6 rounded-lg space-y-4"
          style={{
            backgroundColor: "#1a1a1e",
            border: "1px solid #2a2a2e",
          }}
        >
          <h3
            className="text-lg font-medium flex items-center"
            style={{ color: "#fff" }}
          >
            Cache status
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 items-start">
            <div className="space-y-3 min-w-0">
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <dt style={{ color: "#c1c1c3" }}>Provider</dt>
                  <dd style={{ color: "#fff" }}>{discoveryProvider}</dd>
                </div>
                <div>
                  <dt style={{ color: "#c1c1c3" }}>Last updated</dt>
                  <dd style={{ color: "#fff" }}>
                    {health?.discovery?.lastUpdated
                      ? new Date(
                          health.discovery.lastUpdated,
                        ).toLocaleString()
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt style={{ color: "#c1c1c3" }}>Image cache size</dt>
                  <dd style={{ color: "#fff" }}>
                    {formatBytes(health?.discovery?.cachedImagesSizeBytes)}
                  </dd>
                </div>
                <div>
                  <dt style={{ color: "#c1c1c3" }}>Cached images</dt>
                  <dd style={{ color: "#fff" }}>
                    {health?.discovery?.cachedImagesCount ?? "—"}
                  </dd>
                </div>
              </dl>
              {(health?.discovery?.isUpdating || refreshingDiscovery) && (
                <p
                  className="text-sm flex items-center gap-2"
                  style={{ color: "#c1c1c3" }}
                >
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  {discoveryProgressMessage || "Refreshing discovery"}
                </p>
              )}
              {!refreshingDiscovery &&
                !health?.discovery?.isUpdating &&
                discoveryProgressMessage && (
                  <p className="text-sm" style={{ color: "#8ec07c" }}>
                    {discoveryProgressMessage}
                  </p>
                )}
            </div>
            <div className="flex flex-col gap-3 w-full md:w-auto md:min-w-[220px]">
              <div
                className="rounded-md p-3 space-y-2"
                style={{ border: "1px solid #2a2a2e", backgroundColor: "#141418" }}
              >
                <p className="text-xs uppercase tracking-wide" style={{ color: "#c1c1c3" }}>
                  Discovery data
                </p>
                <button
                  type="button"
                  onClick={handleRefreshDiscovery}
                  disabled={refreshingDiscovery}
                  className="btn btn-primary w-full flex items-center justify-center gap-2 py-2.5 px-4 font-medium shadow-md hover:opacity-90"
                >
                  <RefreshCw
                    className={`w-4 h-4 flex-shrink-0 ${
                      refreshingDiscovery ? "animate-spin" : ""
                    }`}
                  />
                  {refreshingDiscovery ? "Refreshing..." : "Refresh Discovery"}
                </button>
              </div>
              <div
                className="rounded-md p-3 space-y-2"
                style={{ border: "1px solid #2a2a2e", backgroundColor: "#141418" }}
              >
                <p className="text-xs uppercase tracking-wide" style={{ color: "#c1c1c3" }}>
                  Image cache
                </p>
                <button
                  type="button"
                  onClick={handleClearCache}
                  disabled={clearingCache}
                  className="btn btn-secondary w-full flex items-center justify-center gap-2 py-2.5 px-4 font-medium shadow-md"
                >
                  <Trash2
                    className={`w-4 h-4 flex-shrink-0 ${
                      clearingCache ? "animate-spin" : ""
                    }`}
                  />
                  {clearingCache ? "Clearing..." : "Clear Image Cache"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
