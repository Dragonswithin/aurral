import FlipSaveButton from "../../../components/FlipSaveButton";

export function SettingsAccountTab({
  listenHistoryProvider,
  setListenHistoryProvider,
  listenHistoryUsername,
  setListenHistoryUsername,
  lidarrConfigured,
  lidarrRootFolders,
  lidarrQualityProfiles,
  lidarrRootFolderPath,
  setLidarrRootFolderPath,
  lidarrQualityProfileId,
  setLidarrQualityProfileId,
  hasUnsavedChanges,
  loading,
  saving,
  handleSave,
}) {
  if (loading) {
    return (
      <div className="card animate-fade-in">
        <p style={{ color: "#c1c1c3" }}>Loading...</p>
      </div>
    );
  }

  return (
    <div className="card animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h2
          className="text-2xl font-bold flex items-center"
          style={{ color: "#fff" }}
        >
          My Account
        </h2>
        <FlipSaveButton
          saving={saving}
          disabled={!hasUnsavedChanges}
          onClick={handleSave}
        />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
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
              Listening History
            </h3>
            <div className="flex items-center gap-2">
              {listenHistoryUsername && (
                <span className="text-sm" style={{ color: "#c1c1c3" }}>
                  {listenHistoryProvider === "listenbrainz"
                    ? `ListenBrainz: ${listenHistoryUsername}`
                    : `Last.fm: ${listenHistoryUsername}`}
                </span>
              )}
            </div>
          </div>
          <fieldset className="space-y-4">
            <div>
              <label
                className="block text-sm font-medium mb-1"
                style={{ color: "#fff" }}
              >
                Provider
              </label>
              <select
                className="input"
                value={listenHistoryProvider}
                onChange={(e) => setListenHistoryProvider(e.target.value)}
              >
                <option value="lastfm">Last.fm</option>
                <option value="listenbrainz">ListenBrainz</option>
              </select>
            </div>
            <div>
              <label
                className="block text-sm font-medium mb-1"
                style={{ color: "#fff" }}
              >
                Username
              </label>
              <input
                type="text"
                className="input"
                placeholder={
                  listenHistoryProvider === "listenbrainz"
                    ? "Your ListenBrainz username"
                    : "Your Last.fm username"
                }
                autoComplete="off"
                value={listenHistoryUsername}
                onChange={(e) => setListenHistoryUsername(e.target.value)}
              />
              <p className="mt-1 text-xs" style={{ color: "#c1c1c3" }}>
                Connect Last.fm or ListenBrainz for personalized discovery
                recommendations based on your listening history.
              </p>
            </div>
          </fieldset>
        </div>

        <div
          className="p-6 rounded-lg space-y-4"
          style={{
            backgroundColor: "#1a1a1e",
            border: "1px solid #2a2a2e",
          }}
        >
          <div className="mb-2">
            <h3
              className="text-lg font-medium flex items-center"
              style={{ color: "#fff" }}
            >
              Library Defaults
            </h3>
            <p className="mt-1 text-sm" style={{ color: "#c1c1c3" }}>
              These defaults apply to one-click artist adds unless you override
              them from the Customize action on the artist page.
            </p>
          </div>

          <fieldset
            disabled={!lidarrConfigured}
            className={`space-y-4 ${lidarrConfigured ? "" : "opacity-60"}`}
          >
            <div>
              <label
                className="block text-sm font-medium mb-1"
                style={{ color: "#fff" }}
              >
                Default Root Folder
              </label>
              <select
                className="input"
                value={lidarrRootFolderPath}
                onChange={(e) => setLidarrRootFolderPath(e.target.value)}
              >
                <option value="">Use automatic default</option>
                {lidarrRootFolders.map((folder) => (
                  <option key={folder.path} value={folder.path}>
                    {folder.path}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                className="block text-sm font-medium mb-1"
                style={{ color: "#fff" }}
              >
                Default Quality Profile
              </label>
              <select
                className="input"
                value={lidarrQualityProfileId}
                onChange={(e) => setLidarrQualityProfileId(e.target.value)}
              >
                <option value="">Use automatic default</option>
                {lidarrQualityProfiles.map((profile) => (
                  <option key={profile.id} value={String(profile.id)}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </div>
          </fieldset>

          {!lidarrConfigured && (
            <p className="text-xs" style={{ color: "#c1c1c3" }}>
              Lidarr must be configured by an admin before personal library
              defaults can be saved.
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
