import { useState } from "react";
import { CheckCircle, Pencil } from "lucide-react";
import FlipSaveButton from "../../../components/FlipSaveButton";

function ProviderStatusNote({ providerHealth, activeLabel }) {
  if (!providerHealth) return null;

  return (
    <p className="mt-1 text-xs" style={{ color: "#c1c1c3" }}>
      Active route: {activeLabel}.
      {providerHealth.failoverActive
        ? " Narrow fallback is active because the primary BrainzMash endpoint failed recently."
        : " BrainzMash is serving metadata directly."}
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
  const [metadataEditing, setMetadataEditing] = useState(false);
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
              BrainzMash
            </h3>
            <div className="flex items-center gap-2">
              {health?.metadataConfigured && (
                <span className="flex items-center text-sm text-green-400">
                  <CheckCircle className="w-4 h-4 mr-1" />
                  Configured
                </span>
              )}
              <button
                type="button"
                className={`btn ${
                  metadataEditing ? "btn-primary" : "btn-secondary"
                } px-2 py-1`}
                onClick={() => setMetadataEditing((value) => !value)}
                aria-label={
                  metadataEditing
                    ? "Lock metadata settings"
                    : "Edit metadata settings"
                }
              >
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          </div>
          <fieldset
            disabled={!metadataEditing}
            className={`space-y-4 ${metadataEditing ? "" : "opacity-60"}`}
          >
            <div>
              <label
                className="block text-sm font-medium mb-1"
                style={{ color: "#fff" }}
              >
                Provider
              </label>
              <input className="input" value="BrainzMash" disabled />
              <p className="mt-1 text-xs" style={{ color: "#c1c1c3" }}>
                This branch uses a BrainzMash-compatible metadata backend and no
                longer routes normal metadata reads through the old
                MusicBrainz mirror path.
              </p>
              <ProviderStatusNote
                providerHealth={providerHealth.brainzmash}
                activeLabel="BrainzMash"
              />
            </div>
            <div>
              <label
                className="block text-sm font-medium mb-1"
                style={{ color: "#fff" }}
              >
                Base URL
              </label>
              <input
                type="url"
                className="input"
                placeholder="https://lidarrapi.brainzmash.cc"
                autoComplete="off"
                value={settings.integrations?.metadata?.baseUrl || ""}
                onChange={(e) =>
                  updateSettings({
                    ...settings,
                    integrations: {
                      ...settings.integrations,
                      metadata: {
                        ...(settings.integrations?.metadata || {}),
                        provider: "brainzmash",
                        baseUrl: e.target.value,
                      },
                    },
                  })
                }
              />
            </div>
            <div>
              <label
                className="flex items-center gap-2 text-sm font-medium"
                style={{ color: "#fff" }}
              >
                <input
                  type="checkbox"
                  checked={
                    settings.integrations?.metadata?.enableNarrowFallbacks !== false
                  }
                  onChange={(e) =>
                    updateSettings({
                      ...settings,
                      integrations: {
                        ...settings.integrations,
                        metadata: {
                          ...(settings.integrations?.metadata || {}),
                          provider: "brainzmash",
                          enableNarrowFallbacks: e.target.checked,
                        },
                      },
                    })
                  }
                />
                Enable narrow fallbacks
              </label>
              <p className="mt-1 text-xs" style={{ color: "#c1c1c3" }}>
                Keep the BrainzMash-native path primary, but allow isolated
                fallback behavior if a required metadata read cannot be
                satisfied.
              </p>
            </div>
          </fieldset>
        </div>
      </form>
    </div>
  );
}
