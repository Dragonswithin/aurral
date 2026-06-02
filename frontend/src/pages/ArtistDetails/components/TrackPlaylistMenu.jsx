import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { Check, ListMusic, Loader, Plus } from "lucide-react";

export function TrackPlaylistMenu({
  playlists = [],
  loading = false,
  saving = false,
  error = "",
  defaultNewPlaylistName = "Playlist",
  onLoadPlaylists,
  onSelect,
  onOpenChange,
}) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const menuRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (menuRef.current?.contains(event.target)) return;
      setOpen(false);
      onOpenChange?.(false);
    };
    const handleViewportChange = () => {
      setOpen(false);
      onOpenChange?.(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [onOpenChange, open]);

  const handleOpen = async (event) => {
    event.stopPropagation();
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const menuWidth = 256;
      setMenuPosition({
        top: rect.bottom + 8,
        left: Math.max(
          12,
          Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 12),
        ),
      });
    }
    const nextOpen = !open;
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
    if (!open) {
      await onLoadPlaylists?.();
    }
  };

  const handleSelect = async (target) => {
    await onSelect?.(target);
    setOpen(false);
    onOpenChange?.(false);
  };

  return (
    <div className="relative flex-shrink-0" ref={menuRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`group inline-flex h-7 flex-shrink-0 items-center overflow-hidden rounded-full transition-all duration-200 ease-out hover:w-[118px] ${
          open ? "w-[118px]" : "w-7"
        }`}
        style={{
          backgroundColor: "rgba(255,255,255,0.06)",
          color: "#fff",
        }}
        onClick={handleOpen}
        title="Add to playlist"
        aria-label="Add to playlist"
        aria-expanded={open}
        disabled={saving}
      >
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center">
          {saving ? (
            <Loader className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
        </span>
        <span
          className={`pr-3 text-xs font-medium whitespace-nowrap transition-all duration-150 ease-out ${
            open
              ? "translate-x-0 opacity-100"
              : "-translate-x-2 opacity-0 group-hover:translate-x-0 group-hover:opacity-100"
          }`}
        >
          Add to playlist
        </span>
      </button>

      {open ? (
        <div
          className="fixed z-50 w-64 overflow-hidden rounded-xl border border-white/10 bg-[#15151a] py-1 shadow-xl"
          style={{
            top: menuPosition.top,
            left: menuPosition.left,
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-xs font-medium uppercase tracking-[0.14em] text-[#9ea0a8]">
            <ListMusic className="h-3.5 w-3.5" />
            Playlists
          </div>
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-3 text-sm text-[#c1c1c3]">
              <Loader className="h-4 w-4 animate-spin" />
              Loading playlists
            </div>
          ) : (
            <>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-white transition-colors hover:bg-white/5"
                onClick={() =>
                  handleSelect({
                    mode: "new",
                    name: defaultNewPlaylistName,
                  })
                }
                disabled={saving}
              >
                <Plus className="h-4 w-4 flex-shrink-0 text-[#dfe8d2]" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">New playlist</span>
                  <span className="block truncate text-xs text-[#aeb0b7]">
                    {defaultNewPlaylistName}
                  </span>
                </span>
              </button>
              {Array.isArray(playlists) && playlists.length > 0 ? (
                <div className="max-h-64 overflow-y-auto border-t border-white/10 py-1">
                  {playlists.map((playlist) => (
                    <button
                      key={playlist.id}
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm text-white transition-colors hover:bg-white/5"
                      onClick={() =>
                        handleSelect({
                          mode: "existing",
                          playlistId: playlist.id,
                        })
                      }
                      disabled={saving}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {playlist.name}
                        </span>
                        <span className="block text-xs text-[#aeb0b7]">
                          {playlist.trackCount || 0} tracks
                        </span>
                      </span>
                      <Check className="h-4 w-4 flex-shrink-0 opacity-0" />
                    </button>
                  ))}
                </div>
              ) : null}
              {error ? (
                <div className="border-t border-white/10 px-3 py-2 text-xs text-red-400">
                  {error}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

TrackPlaylistMenu.propTypes = {
  playlists: PropTypes.array,
  loading: PropTypes.bool,
  saving: PropTypes.bool,
  error: PropTypes.string,
  defaultNewPlaylistName: PropTypes.string,
  onLoadPlaylists: PropTypes.func,
  onSelect: PropTypes.func,
  onOpenChange: PropTypes.func,
};
