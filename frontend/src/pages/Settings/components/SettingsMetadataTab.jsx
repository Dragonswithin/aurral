import { CheckCircle } from "lucide-react";
import FlipSaveButton from "../../../components/FlipSaveButton";

const DEFAULT_METADATA_BASE_URL = "https://brainzmash.kell.ly";

export function SettingsMetadataTab({
  settings,
  updateSettings,
  health,
  hasUnsavedChanges,
  saving,
  handleSaveSettings,
}) {
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
              Metadata Server
            </h3>
            {health?.metadataConfigured && (
              <span className="flex items-center text-sm text-green-400">
                <CheckCircle className="w-4 h-4 mr-1" />
                Configured
              </span>
            )}
          </div>
          <div className="space-y-4">
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
                placeholder={DEFAULT_METADATA_BASE_URL}
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
          </div>
        </div>
      </form>
    </div>
  );
}
