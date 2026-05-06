import { useState, useEffect, useCallback, useRef } from "react";
import PropTypes from "prop-types";
import { Music, Loader } from "lucide-react";
import { getArtistCover } from "../utils/api";

const queue = [];
let active = 0;
const MAX_CONCURRENT = 4;

const processQueue = () => {
  if (active >= MAX_CONCURRENT || queue.length === 0) return;
  const next = queue.shift();
  active++;
  next().finally(() => {
    active--;
    processQueue();
  });
};

const scheduleFetch = (fn, signal) => {
  return new Promise((resolve, reject) => {
    const entry = async () => {
      try {
        const res = await fn();
        resolve(res);
      } catch (err) {
        reject(err);
      }
    };
    queue.push(entry);

    if (signal) {
      signal.addEventListener("abort", () => {
        const idx = queue.indexOf(entry);
        if (idx !== -1) {
          queue.splice(idx, 1);
          reject(signal.reason || new DOMException("Aborted", "AbortError"));
        }
      });
    }

    processQueue();
  });
};

const ArtistImage = ({
  mbid,
  src,
  alt,
  artistName,
  className = "",
  showLoading = true,
}) => {
  const [currentSrc, setCurrentSrc] = useState(src);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const fetchingRef = useRef(false);
  const triedBackendFallbackRef = useRef(false);

  const abortRef = useRef(null);

  const fetchBackendCover = useCallback(
    async (mbidToFetch, nameForCover, signal, refresh = false) => {
      if (!mbidToFetch || fetchingRef.current) {
        return;
      }

      fetchingRef.current = true;
      try {
        setHasError(false);

        const data = await scheduleFetch(
          () =>
            Promise.race([
              getArtistCover(mbidToFetch, nameForCover, refresh),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Timeout")), 5000),
              ),
            ]),
          signal,
        );
        if (signal?.aborted) return;
        if (data?.images && data.images.length > 0) {
          const front = data.images.find((img) => img.front) || data.images[0];
          const url = front.image;
          if (url) {
            setCurrentSrc(url);
            setHasError(false);
          } else {
            setHasError(true);
            setIsLoading(false);
          }
        } else {
          setHasError(true);
          setIsLoading(false);
        }
      } catch (err) {
        if (err?.name === "AbortError" || signal?.aborted) return;
        setHasError(true);
        setIsLoading(false);
      } finally {
        fetchingRef.current = false;
      }
    },
    [],
  );

  useEffect(() => {
    fetchingRef.current = false;
    triedBackendFallbackRef.current = false;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (src) {
      setCurrentSrc(src);
      setHasError(false);
      setIsLoading(true);
    } else if (mbid) {
      setCurrentSrc(null);
      setHasError(false);
      setIsLoading(true);
      fetchBackendCover(mbid, artistName, controller.signal);
    } else {
      setCurrentSrc(null);
      setIsLoading(false);
      setHasError(true);
    }

    return () => controller.abort();
  }, [src, mbid, artistName, fetchBackendCover]);

  const handleLoad = () => {
    setIsLoading(false);
  };

  const handleError = () => {
    if (mbid && !triedBackendFallbackRef.current) {
      triedBackendFallbackRef.current = true;
      setIsLoading(true);
      setHasError(false);
      fetchBackendCover(mbid, artistName, abortRef.current?.signal, true);
      return;
    }
    setHasError(true);
    setIsLoading(false);
  };

  if (hasError) {
    return (
      <div
        className={`flex items-center justify-center ${className}`}
        style={{ backgroundColor: "#211f27", color: "#c1c1c3" }}
      >
        <Music className="w-1/3 h-1/3" />
      </div>
    );
  }

  if (!currentSrc && !isLoading && !hasError) {
    return (
      <div
        className={`relative overflow-hidden ${className}`}
        style={{ backgroundColor: "#211f27" }}
      >
        {showLoading && (
          <div
            className="absolute inset-0 flex items-center justify-center z-10"
            style={{ backgroundColor: "#211f27" }}
          >
            <Loader
              className="w-6 h-6 animate-spin"
              style={{ color: "#c1c1c3" }}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ backgroundColor: "#211f27" }}
    >
      {isLoading && showLoading && (
        <div
          className="absolute inset-0 flex items-center justify-center z-10"
          style={{ backgroundColor: "#211f27" }}
        >
          <Loader className="w-6 h-6 text-primary-500 animate-spin" />
        </div>
      )}
      {currentSrc && (
        <img
          src={currentSrc}
          alt={alt || "Artist cover"}
          className={`w-full h-full object-cover transition-opacity duration-200 ${
            isLoading ? "opacity-0" : "opacity-100"
          }`}
          onLoad={handleLoad}
          onError={handleError}
          loading="lazy"
          decoding="async"
          style={{ contentVisibility: "auto" }}
        />
      )}
    </div>
  );
};

ArtistImage.propTypes = {
  mbid: PropTypes.string,
  src: PropTypes.string,
  alt: PropTypes.string,
  artistName: PropTypes.string,
  className: PropTypes.string,
  showLoading: PropTypes.bool,
};

export default ArtistImage;
