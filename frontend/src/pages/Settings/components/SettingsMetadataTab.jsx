import { useState } from "react";
import { CheckCircle, Pencil } from "lucide-react";
import FlipSaveButton from "../../../components/FlipSaveButton";

function ProviderStatusNote({ providerHealth, hostedLabel, officialLabel }) {
  if (!providerHealth) return null;

  const activeLabel =
    providerHealth.activeProvider === "aurralHosted"
      ? hostedLabel
      : providerHealth.activeProvider === "official"
        ? officialLabel
        : "Custom provider";

  if (providerHealth.mode !== "auto") {
    return (
      <p className="mt-1 text-xs" style={{ color: "#c1c1c3" }}>
        Using {activeLabel}. Automatic hosted failover is disabled while a
        manual provider is selected.
      </p>
    );
  }

  return (
    <p className="mt-1 text-xs" style={{ color: "#c1c1c3" }}>
      Active route: {activeLabel}.
      {providerHealth.failoverActive
        ? " Hosted health checks failed repeatedly, so requests are temporarily using the official endpoint until the hosted route recovers."
        : " Hosted mode stays pinned to the hosted cache and only fails over after repeated background health check failures."}
    </p>
  );
}

export function SettingsMetadataTab({
  settings,
  updateSettings,
  health,
  hasUnsavedChanges,
  saving,
  handleSaveSettings,
}) {
  const [musicbrainzEditing, setMusicbrainzEditing] = useState(false);
  const providerHealth = health?.metadataProviders || {};

  return (
    <div className="card animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h2
          className="text-2xl font-bold flex items-center"
          style={{ color: "#fff" }}
        >
          Metadata Services
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
        <div
          className="p-6 rounded-lg space-y-4"
          style={{
            backgroundColor: "#1a1a1e",
            border: "1px solid #2a2a2e",
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <h3
              className="text-lg font-medium flex items-center"
              style={{ color: "#fff" }}
            >
              MusicBrainz
            </h3>
            <div className="flex items-center gap-2">
              {health?.musicbrainzConfigured && (
                <span className="flex items-center text-sm text-green-400">
                  <CheckCircle className="w-4 h-4 mr-1" />
                  Configured
                </span>
              )}
              <button
                type="button"
                className={`btn ${
                  musicbrainzEditing ? "btn-primary" : "btn-secondary"
                } px-2 py-1`}
                onClick={() => setMusicbrainzEditing((value) => !value)}
                aria-label={
                  musicbrainzEditing
                    ? "Lock MusicBrainz settings"
                    : "Edit MusicBrainz settings"
                }
              >
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          </div>
          <fieldset
            disabled={!musicbrainzEditing}
            className={`space-y-4 ${musicbrainzEditing ? "" : "opacity-60"}`}
          >
            <div>
              <label
                className="block text-sm font-medium mb-1"
                style={{ color: "#fff" }}
              >
                Metadata source
              </label>
              <select
                className="input"
                value={
                  settings.integrations?.musicbrainz?.provider ||
                  "aurralHosted"
                }
                onChange={(e) =>
                  updateSettings({
                    ...settings,
                    integrations: {
                      ...settings.integrations,
                      musicbrainz: {
                        ...(settings.integrations?.musicbrainz || {}),
                        provider: e.target.value,
                      },
                    },
                  })
                }
              >
                <option value="aurralHosted">
                  Aurral-hosted MusicBrainz mirror
                </option>
                <option value="official">Official MusicBrainz API</option>
                <option value="custom">Custom self-hosted instance</option>
              </select>
              <p className="mt-1 text-xs" style={{ color: "#c1c1c3" }}>
                Aurral-hosted is quicker but may have downtime. Official is
                slower but usually steadier. Custom lets users point at their
                own MusicBrainz API.
              </p>
              <ProviderStatusNote
                providerHealth={providerHealth.musicbrainz}
                hostedLabel="Aurral-hosted MusicBrainz mirror"
                officialLabel="Official MusicBrainz API"
              />
            </div>
            {(settings.integrations?.musicbrainz?.provider || "aurralHosted") ===
              "custom" && (
              <div>
                <label
                  className="block text-sm font-medium mb-1"
                  style={{ color: "#fff" }}
                >
                  Custom API URL
                </label>
                <input
                  type="url"
                  className="input"
                  placeholder="https://musicbrainz.example.com/ws/2"
                  autoComplete="off"
                  value={settings.integrations?.musicbrainz?.customUrl || ""}
                  onChange={(e) =>
                    updateSettings({
                      ...settings,
                      integrations: {
                        ...settings.integrations,
                        musicbrainz: {
                          ...(settings.integrations?.musicbrainz || {}),
                          customUrl: e.target.value,
                        },
                      },
                    })
                  }
                />
                <p className="mt-1 text-xs" style={{ color: "#c1c1c3" }}>
                  Enter the MusicBrainz API base URL. If you omit `/ws/2`, it
                  will be added automatically.
                </p>
              </div>
            )}
          </fieldset>
        </div>
      </form>
    </div>
  );
}
