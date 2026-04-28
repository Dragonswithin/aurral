import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ListMusic, Loader2, Plus, X } from "lucide-react";

function ModalShell({
  open,
  title,
  description = "",
  onClose,
  children,
  footer,
  disableClose = false,
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.78)" }}
      onClick={disableClose ? undefined : onClose}
    >
      <div
        className="card w-full max-w-2xl border border-white/10 bg-[#1c1b22] shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-white">{title}</h3>
            {description ? (
              <p className="text-sm text-[#b8b8bf]">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={disableClose ? undefined : onClose}
            className="btn btn-ghost btn-sm p-2"
            aria-label="Close"
            disabled={disableClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 px-5 py-4">
          {footer}
        </div>
      </div>
    </div>
  );
}

function normalizeTrackDraft(track, index) {
  return {
    rowId: `track-${index}`,
    artistName: String(track?.artistName || "").trim(),
    trackName: String(track?.trackName || "").trim(),
    albumName: String(track?.albumName || "").trim(),
    artistMbid: String(track?.artistMbid || "").trim(),
    albumMbid: String(track?.albumMbid || "").trim(),
    trackMbid: String(track?.trackMbid || "").trim(),
    releaseYear: String(track?.releaseYear || "").trim(),
    durationMs:
      track?.durationMs != null && Number.isFinite(Number(track.durationMs))
        ? Math.max(0, Math.round(Number(track.durationMs)))
        : null,
    artistAliases: Array.isArray(track?.artistAliases)
      ? track.artistAliases
          .map((entry) => String(entry || "").trim())
          .filter(Boolean)
      : [],
    reason: String(track?.reason || "").trim(),
  };
}

function buildTrackPayload(drafts) {
  return (Array.isArray(drafts) ? drafts : []).map((draft) => {
    const artistName = String(draft?.artistName || "").trim();
    const trackName = String(draft?.trackName || "").trim();
    const albumName = String(draft?.albumName || "").trim();
    if (!artistName || !trackName) {
      throw new Error("Each track needs both an artist and song name");
    }
    const artistMbid = String(draft?.artistMbid || "").trim();
    const albumMbid = String(draft?.albumMbid || "").trim();
    const trackMbid = String(draft?.trackMbid || "").trim();
    const releaseYear = String(draft?.releaseYear || "").trim();
    const reason = String(draft?.reason || "").trim();
    const durationMs =
      draft?.durationMs != null && Number.isFinite(Number(draft.durationMs))
        ? Math.max(0, Math.round(Number(draft.durationMs)))
        : null;
    const artistAliases = Array.isArray(draft?.artistAliases)
      ? draft.artistAliases
          .map((entry) => String(entry || "").trim())
          .filter(Boolean)
      : [];
    return {
      artistName,
      trackName,
      albumName: albumName || null,
      artistMbid: artistMbid || null,
      albumMbid: albumMbid || null,
      trackMbid: trackMbid || null,
      releaseYear: releaseYear || null,
      durationMs,
      artistAliases,
      reason: reason || null,
    };
  });
}

export function CreatePlaylistModal({
  open,
  defaultName = "",
  saving = false,
  error = "",
  onClose,
  onSubmit,
}) {
  const [name, setName] = useState(defaultName);
  const [localError, setLocalError] = useState("");
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setName(defaultName);
      setLocalError("");
    }
    wasOpenRef.current = open;
  }, [defaultName, open]);

  const handleSubmit = async () => {
    const nextName = String(name || "").trim();
    if (!nextName) {
      setLocalError("Playlist name is required");
      return;
    }
    setLocalError("");
    await onSubmit?.(nextName);
  };

  return (
    <ModalShell
      open={open}
      title="New Playlist"
      description="Create a manual playlist you can build up track by track."
      onClose={onClose}
      disableClose={saving}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary btn-sm"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="btn btn-primary btn-sm gap-2"
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Create Playlist
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block text-sm font-medium text-white">
          Playlist Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (localError) setLocalError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleSubmit();
            }
          }}
          className="input h-11 w-full bg-[#15151a]"
          placeholder="Night Drive"
          autoFocus
        />
        {localError || error ? (
          <p className="text-sm text-red-400">{localError || error}</p>
        ) : null}
      </div>
    </ModalShell>
  );
}

export function PlaylistTrackModal({
  open,
  title = "Add To Playlist",
  description = "",
  playlists = [],
  initialTracks = [],
  excludedPlaylistIds = [],
  defaultNewPlaylistName = "",
  saving = false,
  error = "",
  onClose,
  onSubmit,
}) {
  const availablePlaylists = useMemo(() => {
    const excluded = new Set(
      (Array.isArray(excludedPlaylistIds) ? excludedPlaylistIds : [])
        .map((entry) => String(entry || "").trim())
        .filter(Boolean),
    );
    return (Array.isArray(playlists) ? playlists : []).filter(
      (playlist) => !excluded.has(String(playlist?.id || "").trim()),
    );
  }, [excludedPlaylistIds, playlists]);

  const [targetMode, setTargetMode] = useState(
    availablePlaylists.length > 0 ? "existing" : "new",
  );
  const [playlistId, setPlaylistId] = useState("");
  const [playlistName, setPlaylistName] = useState(defaultNewPlaylistName);
  const [trackDrafts, setTrackDrafts] = useState(() =>
    (Array.isArray(initialTracks) ? initialTracks : []).map(normalizeTrackDraft),
  );
  const [localError, setLocalError] = useState("");
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setTargetMode(availablePlaylists.length > 0 ? "existing" : "new");
      setPlaylistId(String(availablePlaylists[0]?.id || ""));
      setPlaylistName(defaultNewPlaylistName);
      setTrackDrafts(
        (Array.isArray(initialTracks) ? initialTracks : []).map(
          normalizeTrackDraft,
        ),
      );
      setLocalError("");
    }
    wasOpenRef.current = open;
  }, [availablePlaylists, defaultNewPlaylistName, initialTracks, open]);

  const updateTrackField = (rowId, key, value) => {
    setTrackDrafts((prev) =>
      prev.map((track) =>
        track.rowId === rowId ? { ...track, [key]: value } : track,
      ),
    );
    if (localError) {
      setLocalError("");
    }
  };

  const handleSubmit = async () => {
    try {
      const tracks = buildTrackPayload(trackDrafts);
      if (tracks.length === 0) {
        throw new Error("No track is ready to add");
      }
      if (targetMode === "existing") {
        if (!playlistId) {
          throw new Error("Choose a playlist");
        }
        setLocalError("");
        await onSubmit?.({
          mode: "existing",
          playlistId,
          tracks,
        });
        return;
      }
      const nextName = String(playlistName || "").trim();
      if (!nextName) {
        throw new Error("Playlist name is required");
      }
      setLocalError("");
      await onSubmit?.({
        mode: "new",
        name: nextName,
        tracks,
      });
    } catch (submitError) {
      setLocalError(submitError?.message || "Failed to add track");
    }
  };

  return (
    <ModalShell
      open={open}
      title={title}
      description={description}
      onClose={onClose}
      disableClose={saving}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary btn-sm"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="btn btn-primary btn-sm gap-2"
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Save To Playlist
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {availablePlaylists.length > 0 ? (
          <div className="inline-flex rounded-lg border border-white/10 bg-black/20 p-1">
            <button
              type="button"
              onClick={() => setTargetMode("existing")}
              className={`rounded-md px-3 py-2 text-sm transition ${
                targetMode === "existing"
                  ? "bg-[#707e61] text-white"
                  : "text-[#c2c2c8]"
              }`}
            >
              Existing Playlist
            </button>
            <button
              type="button"
              onClick={() => setTargetMode("new")}
              className={`rounded-md px-3 py-2 text-sm transition ${
                targetMode === "new"
                  ? "bg-[#707e61] text-white"
                  : "text-[#c2c2c8]"
              }`}
            >
              New Playlist
            </button>
          </div>
        ) : null}

        {targetMode === "existing" && availablePlaylists.length > 0 ? (
          <div className="grid gap-2">
            <label className="text-sm font-medium text-white">
              Choose Playlist
            </label>
            <div className="grid gap-2">
              {availablePlaylists.map((playlist) => {
                const selected = playlistId === playlist.id;
                return (
                  <button
                    key={playlist.id}
                    type="button"
                    onClick={() => setPlaylistId(playlist.id)}
                    className={`flex items-center justify-between rounded-xl border px-3 py-3 text-left transition ${
                      selected
                        ? "border-[#8fa07b] bg-[#2a3223]"
                        : "border-white/10 bg-[#15151a] hover:border-white/20"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-white">
                        {playlist.name}
                      </div>
                      <div className="text-xs text-[#b8b8bf]">
                        {playlist.trackCount || 0} tracks
                      </div>
                    </div>
                    {selected ? (
                      <Check className="h-4 w-4 shrink-0 text-[#dfe8d2]" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="grid gap-2">
            <label className="text-sm font-medium text-white">
              New Playlist Name
            </label>
            <input
              type="text"
              value={playlistName}
              onChange={(event) => {
                setPlaylistName(event.target.value);
                if (localError) setLocalError("");
              }}
              className="input h-11 w-full bg-[#15151a]"
              placeholder="Sunday picks"
            />
          </div>
        )}

        <div className="rounded-xl border border-white/10 bg-[#15151a]">
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-xs uppercase tracking-[0.18em] text-[#9ea0a8]">
            <ListMusic className="h-3.5 w-3.5" />
            Tracks
          </div>
          <div className="divide-y divide-white/5">
            {trackDrafts.map((track) => (
              <div
                key={track.rowId}
                className="grid gap-3 px-3 py-3 md:grid-cols-3"
              >
                <div className="grid gap-1">
                  <label className="text-xs text-[#aeb0b7]">Song</label>
                  <input
                    type="text"
                    value={track.trackName}
                    onChange={(event) =>
                      updateTrackField(
                        track.rowId,
                        "trackName",
                        event.target.value,
                      )
                    }
                    className="input input-sm bg-[#101015]"
                  />
                </div>
                <div className="grid gap-1">
                  <label className="text-xs text-[#aeb0b7]">Artist</label>
                  <input
                    type="text"
                    value={track.artistName}
                    onChange={(event) =>
                      updateTrackField(
                        track.rowId,
                        "artistName",
                        event.target.value,
                      )
                    }
                    className="input input-sm bg-[#101015]"
                  />
                </div>
                <div className="grid gap-1">
                  <label className="text-xs text-[#aeb0b7]">Album</label>
                  <input
                    type="text"
                    value={track.albumName}
                    onChange={(event) =>
                      updateTrackField(
                        track.rowId,
                        "albumName",
                        event.target.value,
                      )
                    }
                    className="input input-sm bg-[#101015]"
                    placeholder="Optional"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {localError || error ? (
          <p className="text-sm text-red-400">{localError || error}</p>
        ) : null}
      </div>
    </ModalShell>
  );
}
