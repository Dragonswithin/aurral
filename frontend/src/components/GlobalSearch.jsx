import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ChevronDown, Loader2, Search } from "lucide-react";
import {
  getBootstrapStatus,
  getTagSuggestions,
  searchArtists,
} from "../utils/api";

const AUTOCOMPLETE_DEBOUNCE_MS = 250;
const AUTOCOMPLETE_LIMIT = 6;
const TAG_SUGGESTIONS_LIMIT = 8;
const SEARCH_SCOPES = [
  { value: "artist", label: "Artist", shortLabel: "Artist" },
  { value: "album", label: "Album/Release", shortLabel: "Release" },
  { value: "tag", label: "Tag", shortLabel: "Tag" },
];

function normalizeArtistName(value) {
  if (!value || typeof value !== "string") return "";
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s4$/g, " for")
    .replace(/\s*[.\-_]\s*$/g, "")
    .trim();
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName.toLowerCase();
  return ["input", "textarea", "select"].includes(tagName);
}

function GlobalSearch() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState("artist");
  const [lastfmConfigured, setLastfmConfigured] = useState(true);
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionMode, setSuggestionMode] = useState(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const searchContainerRef = useRef(null);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  const closeAutocomplete = useCallback(() => {
    setSuggestions([]);
    setSuggestionMode(null);
    setSuggestionIndex(-1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadBootstrapStatus = async () => {
      try {
        const bootstrap = await getBootstrapStatus();
        if (!cancelled) {
          setLastfmConfigured(!!bootstrap.lastfmConfigured);
        }
      } catch {
        if (!cancelled) {
          setLastfmConfigured(true);
        }
      }
    };
    loadBootstrapStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  const availableScopes = lastfmConfigured
    ? SEARCH_SCOPES
    : SEARCH_SCOPES.filter((scope) => scope.value !== "tag");

  const selectedScope =
    availableScopes.find((scope) => scope.value === searchScope) ||
    availableScopes[0];

  useEffect(() => {
    if (!lastfmConfigured && searchScope === "tag") {
      setSearchScope("artist");
    }
  }, [lastfmConfigured, searchScope]);

  useEffect(() => {
    setSearchQuery("");
    closeAutocomplete();
  }, [location.pathname, location.search, closeAutocomplete]);

  useEffect(() => {
    const handleGlobalKeyDown = (event) => {
      if (
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    const isTagShortcut = lastfmConfigured && trimmed.startsWith("#");
    const effectiveScope = isTagShortcut ? "tag" : searchScope;
    const tagPart = isTagShortcut ? trimmed.slice(1).trim() : trimmed;
    const shouldAutocomplete =
      effectiveScope === "tag"
        ? isTagShortcut || searchScope === "tag"
        : effectiveScope === "artist";

    if (
      !shouldAutocomplete ||
      (effectiveScope === "artist" && trimmed.length < 2) ||
      (effectiveScope === "tag" && !isTagShortcut && trimmed.length < 2)
    ) {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      closeAutocomplete();
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      debounceRef.current = null;
      setLoadingSuggestions(true);
      try {
        if (effectiveScope === "tag") {
          const data = await getTagSuggestions(tagPart, TAG_SUGGESTIONS_LIMIT);
          const raw = data.tags || [];
          const seen = new Set();
          const list = raw.filter((tag) => {
            const key = String(tag || "")
              .trim()
              .toLowerCase();
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          setSuggestions(list);
          setSuggestionMode("tag");
          setSuggestionIndex(-1);
          return;
        }

        const data = await searchArtists(trimmed, AUTOCOMPLETE_LIMIT, 0);
        const raw = data.artists || [];
        const seenIds = new Set();
        const seenNames = new Set();
        const list = raw.filter((artist) => {
          if (!artist?.id || seenIds.has(artist.id)) return false;
          const key = normalizeArtistName(artist.name);
          if (!key || seenNames.has(key)) return false;
          seenIds.add(artist.id);
          seenNames.add(key);
          return true;
        });
        setSuggestions(list);
        setSuggestionMode("artist");
        setSuggestionIndex(-1);
      } catch {
        closeAutocomplete();
      } finally {
        setLoadingSuggestions(false);
      }
    }, AUTOCOMPLETE_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, searchScope, closeAutocomplete, lastfmConfigured]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target)
      ) {
        setScopeMenuOpen(false);
        closeAutocomplete();
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [closeAutocomplete]);

  const navigateToSearch = useCallback(
    (rawQuery, scopeOverride = null) => {
      const trimmed = String(rawQuery || "").trim();
      if (!trimmed) return;
      if (trimmed.startsWith("#")) {
        navigate(`/search?q=${encodeURIComponent(trimmed.slice(1))}&type=tag`);
      } else {
        const effectiveScope = scopeOverride || searchScope;
        navigate(
          `/search?q=${encodeURIComponent(trimmed)}&type=${encodeURIComponent(
            effectiveScope,
          )}`,
        );
      }
      setSearchQuery("");
      setScopeMenuOpen(false);
      closeAutocomplete();
    },
    [navigate, searchScope, closeAutocomplete],
  );

  const handleSubmit = (event) => {
    event.preventDefault();
    navigateToSearch(searchQuery);
  };

  const handleSuggestionSelect = useCallback(
    (selection) => {
      if (typeof selection === "string") {
        navigate(`/search?q=${encodeURIComponent(selection)}&type=tag`);
        setSearchQuery("");
        setScopeMenuOpen(false);
        closeAutocomplete();
        return;
      }
      if (!selection?.id) return;
      navigate(`/artist/${selection.id}`, {
        state: { artistName: selection.name },
      });
      setSearchQuery("");
      setScopeMenuOpen(false);
      closeAutocomplete();
    },
    [navigate, closeAutocomplete],
  );

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      closeAutocomplete();
      return;
    }
    if (suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSuggestionIndex((current) =>
        current < suggestions.length - 1 ? current + 1 : current,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSuggestionIndex((current) => (current > 0 ? current - 1 : -1));
    } else if (event.key === "Enter" && suggestionIndex >= 0) {
      event.preventDefault();
      handleSuggestionSelect(suggestions[suggestionIndex]);
    }
  };

  return (
    <form
      ref={searchContainerRef}
      onSubmit={handleSubmit}
      className="relative flex-1"
    >
      <div
        className="relative flex items-stretch overflow-visible rounded-xl border shadow-[0_0_0_1px_rgba(255,255,255,0.03),0_12px_32px_rgba(0,0,0,0.24)]"
        style={{
          background:
            "linear-gradient(180deg, rgba(26,26,31,0.96), rgba(20,20,24,0.96))",
          borderColor: "rgba(193,193,195,0.18)",
        }}
      >
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setScopeMenuOpen((open) => !open)}
            className="flex h-full min-w-[96px] items-center gap-2 px-3 text-sm font-medium transition-colors hover:bg-white/[0.035] focus:outline-none sm:min-w-[132px] sm:px-4"
            style={{
              color: "#f3f3f4",
              backgroundColor: scopeMenuOpen
                ? "rgba(255,255,255,0.04)"
                : "rgba(255,255,255,0.02)",
            }}
            aria-haspopup="listbox"
            aria-expanded={scopeMenuOpen}
            aria-label="Search scope"
          >
            <span className="sm:hidden">{selectedScope.shortLabel}</span>
            <span className="hidden sm:inline">{selectedScope.label}</span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${
                scopeMenuOpen ? "rotate-180" : ""
              }`}
              style={{ color: "#9f9fa5" }}
            />
          </button>

          {scopeMenuOpen && (
            <div
              className="absolute left-0 top-[calc(100%+8px)] z-[70] min-w-[152px] overflow-hidden rounded-xl border shadow-[0_18px_48px_rgba(0,0,0,0.45)] sm:min-w-[180px]"
              style={{
                backgroundColor: "#17171c",
                borderColor: "rgba(193,193,195,0.14)",
              }}
            >
              <ul className="py-1">
                {availableScopes.map((scope) => {
                  const selected = scope.value === searchScope;
                  return (
                    <li key={scope.value}>
                      <button
                        type="button"
                        onClick={() => {
                          setSearchScope(scope.value);
                          setScopeMenuOpen(false);
                        }}
                        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm transition-colors hover:bg-white/[0.05] focus:bg-white/[0.05] focus:outline-none"
                        style={{ color: selected ? "#fff" : "#d0d0d4" }}
                        role="option"
                        aria-selected={selected}
                      >
                        <span className="sm:hidden">{scope.shortLabel}</span>
                        <span className="hidden sm:inline">{scope.label}</span>
                        {selected && (
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: "#c1c1c3" }}
                          />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        <div
          className="my-2 w-px shrink-0"
          style={{ backgroundColor: "rgba(193,193,195,0.14)" }}
        />

        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Search className="h-5 w-5" style={{ color: "#a7a7ad" }} />
          </div>
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder=""
            className="block w-full bg-transparent py-3 pl-11 pr-4 text-sm focus:outline-none sm:pr-10"
            style={{
              color: "#fff",
            }}
            autoComplete="off"
          />
          {!searchQuery && (
            <div
              className="pointer-events-none absolute inset-y-0 left-0 flex items-center gap-2 pl-11 pr-4 text-[15px]"
              style={{ color: "#92929a" }}
            >
              <span className="sm:hidden">Search...</span>
              <span className="hidden sm:inline">Type</span>
              <span
                className="hidden sm:inline-flex h-6 min-w-6 items-center justify-center rounded-md border px-1.5 text-[13px] font-medium"
                style={{
                  borderColor: "rgba(193,193,195,0.28)",
                  backgroundColor: "rgba(255,255,255,0.03)",
                  color: "#e6e6e8",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                }}
              >
                /
              </span>
              <span className="hidden sm:inline">to search</span>
            </div>
          )}
          {loadingSuggestions && (
            <div
              className="pointer-events-none absolute inset-y-0 right-3 flex items-center"
              style={{ color: "#c1c1c3" }}
            >
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
        </div>
      </div>

      {!loadingSuggestions && suggestions.length > 0 && (
        <ul
          className="absolute left-0 right-0 top-full z-50 mt-2 max-h-64 overflow-x-hidden overflow-y-auto rounded-xl border py-1 shadow-[0_18px_48px_rgba(0,0,0,0.45)]"
          style={{
            backgroundColor: "#17171c",
            borderColor: "rgba(193,193,195,0.14)",
          }}
        >
          {suggestionMode === "tag"
            ? suggestions.map((tagName, index) => (
                <li key={tagName}>
                  <button
                    type="button"
                    onClick={() => handleSuggestionSelect(tagName)}
                    className="w-full px-4 py-2.5 text-left text-sm hover:bg-white/10 focus:bg-white/10 focus:outline-none"
                    style={{
                      color: "#fff",
                      backgroundColor:
                        index === suggestionIndex
                          ? "rgba(255,255,255,0.1)"
                          : undefined,
                    }}
                  >
                    #{tagName}
                  </button>
                </li>
              ))
            : suggestions.map((artist, index) => (
                <li key={artist.id || index}>
                  <button
                    type="button"
                    onClick={() => handleSuggestionSelect(artist)}
                    className="w-full px-4 py-2.5 text-left text-sm hover:bg-white/10 focus:bg-white/10 focus:outline-none"
                    style={{
                      color: "#fff",
                      backgroundColor:
                        index === suggestionIndex
                          ? "rgba(255,255,255,0.1)"
                          : undefined,
                    }}
                  >
                    {artist.name}
                  </button>
                </li>
              ))}
        </ul>
      )}
    </form>
  );
}

export default GlobalSearch;
