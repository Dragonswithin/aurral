import { allReleaseTypes } from "./constants";

const DEFAULT_METADATA_BASE_URL = "https://brainzmash.kell.ly";

export const normalizeSettings = (savedSettings) => {
  const lidarr = savedSettings.integrations?.lidarr || {};
  const lastfm = savedSettings.integrations?.lastfm || {};
  const legacyMusicbrainz = savedSettings.integrations?.musicbrainz || {};
  const metadata = savedSettings.integrations?.metadata || {};
  const parsedAutoRefreshHours = parseInt(lastfm.discoveryAutoRefreshHours, 10);
  const normalizedAutoRefreshHours = [24, 168, 720].includes(
    parsedAutoRefreshHours,
  )
    ? parsedAutoRefreshHours
    : 168;
  return {
    ...savedSettings,
    releaseTypes: savedSettings.releaseTypes || allReleaseTypes,
    quality: savedSettings.quality || "standard",
    integrations: {
      lidarr: {
        url: "",
        externalUrl: "",
        apiKey: "",
        searchOnAdd: false,
        defaultMonitorOption: "none",
        ...lidarr,
        qualityProfileId:
          lidarr.qualityProfileId != null
            ? parseInt(lidarr.qualityProfileId, 10)
            : null,
        metadataProfileId:
          lidarr.metadataProfileId != null
            ? parseInt(lidarr.metadataProfileId, 10)
            : null,
        tagId:
          lidarr.tagId != null ? parseInt(lidarr.tagId, 10) : null,
      },
      navidrome: {
        url: "",
        username: "",
        password: "",
        ...(savedSettings.integrations?.navidrome || {}),
      },
      lastfm: {
        apiKey: "",
        username: "",
        discoveryPeriod: "1month",
        discoveryAutoRefreshHours: normalizedAutoRefreshHours,
        discoveryRecommendationsPerRefresh: 200,
        discoveryMode:
          lastfm.discoveryMode === "safer" || lastfm.discoveryMode === "deeper"
            ? lastfm.discoveryMode
            : "balanced",
        ...lastfm,
      },
      slskd: {
        url: "",
        apiKey: "",
        ...(savedSettings.integrations?.slskd || {}),
      },
      ticketmaster: {
        apiKey: "",
        searchRadiusMiles: 50,
        localDiscoveryIncludeRecommendations: true,
        localDiscoveryIncludeTrending: true,
        ...(savedSettings.integrations?.ticketmaster || {}),
      },
      metadata: {
        provider: "brainzmash",
        baseUrl:
          metadata.baseUrl ||
          String(legacyMusicbrainz.customUrl || "")
            .trim()
            .replace(/\/ws\/2\/?$/, "") ||
          DEFAULT_METADATA_BASE_URL,
        userAgentSuffix: "",
        enableNarrowFallbacks: true,
        ...metadata,
      },
      general: {
        authUser: "",
        authPassword: "",
        ...(savedSettings.integrations?.general || {}),
      },
      gotify: {
        url: "",
        token: "",
        notifyDiscoveryUpdated: false,
        notifyWeeklyFlowDone: false,
        ...(savedSettings.integrations?.gotify || {}),
      },
      webhooks: savedSettings.integrations?.webhooks || [],
      webhookEvents: {
        notifyDiscoveryUpdated: false,
        notifyWeeklyFlowDone: false,
        ...(savedSettings.integrations?.webhookEvents || {}),
      },
    },
  };
};

export const checkForChanges = (newSettings, originalSettings) => {
  if (!originalSettings) return false;
  return JSON.stringify(newSettings) !== JSON.stringify(originalSettings);
};
