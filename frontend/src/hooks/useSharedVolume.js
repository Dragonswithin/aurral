import { useCallback, useEffect, useState } from "react";

const SHARED_VOLUME_KEY = "aurral.preview.volume";
const SHARED_VOLUME_EVENT = "aurral:shared-volume-change";
const DEFAULT_VOLUME = 0.7;

function normalizeVolume(value) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return DEFAULT_VOLUME;
  return Math.max(0, Math.min(1, parsed));
}

function readStoredVolume() {
  if (typeof window === "undefined") return DEFAULT_VOLUME;
  const stored = window.localStorage.getItem(SHARED_VOLUME_KEY);
  return stored == null ? DEFAULT_VOLUME : normalizeVolume(stored);
}

function writeStoredVolume(value) {
  if (typeof window === "undefined") return;
  const nextVolume = normalizeVolume(value);
  window.localStorage.setItem(SHARED_VOLUME_KEY, String(nextVolume));
  window.dispatchEvent(
    new CustomEvent(SHARED_VOLUME_EVENT, { detail: nextVolume }),
  );
}

export function useSharedVolume() {
  const [volume, setVolumeState] = useState(readStoredVolume);

  useEffect(() => {
    const handleVolumeChange = (event) => {
      if (event.type === "storage" && event.key !== SHARED_VOLUME_KEY) return;
      setVolumeState(
        event.type === SHARED_VOLUME_EVENT
          ? normalizeVolume(event.detail)
          : readStoredVolume(),
      );
    };

    window.addEventListener(SHARED_VOLUME_EVENT, handleVolumeChange);
    window.addEventListener("storage", handleVolumeChange);

    return () => {
      window.removeEventListener(SHARED_VOLUME_EVENT, handleVolumeChange);
      window.removeEventListener("storage", handleVolumeChange);
    };
  }, []);

  const setVolume = useCallback((nextVolume) => {
    const normalized =
      typeof nextVolume === "function"
        ? normalizeVolume(nextVolume(readStoredVolume()))
        : normalizeVolume(nextVolume);
    setVolumeState(normalized);
    writeStoredVolume(normalized);
  }, []);

  return [volume, setVolume];
}
