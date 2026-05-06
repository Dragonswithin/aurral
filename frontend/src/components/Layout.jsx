import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import PropTypes from "prop-types";
import { Link, useLocation } from "react-router-dom";
import {
  Menu,
  Heart,
  Sparkles,
  Library,
  History,
  Ellipsis,
  Ticket,
  AudioWaveform,
  Ban,
  Settings,
  LogOut,
} from "lucide-react";
import Sidebar from "./Sidebar";
import GlobalSearch from "./GlobalSearch";
import { useAuth } from "../contexts/AuthContext";

const VALID_SIDEBAR_MODES = ["full", "icons", "hidden"];

function GitHubIcon({ className = "" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M12 .5C5.649.5.5 5.649.5 12c0 5.084 3.292 9.398 7.861 10.919.575.106.786-.25.786-.556 0-.274-.01-1-.016-1.962-3.197.695-3.872-1.541-3.872-1.541-.523-1.328-1.277-1.682-1.277-1.682-1.044-.714.079-.699.079-.699 1.154.081 1.761 1.185 1.761 1.185 1.026 1.758 2.692 1.25 3.348.956.104-.743.402-1.251.731-1.539-2.552-.291-5.236-1.276-5.236-5.681 0-1.255.449-2.282 1.184-3.086-.119-.291-.513-1.462.112-3.048 0 0 .966-.309 3.165 1.179A10.98 10.98 0 0 1 12 6.033c.973.004 1.954.132 2.87.388 2.197-1.488 3.162-1.179 3.162-1.179.627 1.586.233 2.757.114 3.048.737.804 1.182 1.831 1.182 3.086 0 4.416-2.688 5.387-5.249 5.673.413.355.781 1.055.781 2.126 0 1.535-.014 2.772-.014 3.149 0 .309.207.668.792.555C20.211 21.394 23.5 17.082 23.5 12 23.5 5.649 18.351.5 12 .5Z" />
    </svg>
  );
}

GitHubIcon.propTypes = {
  className: PropTypes.string,
};

function Layout({ children, appVersion }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [sidebarMode, setSidebarMode] = useState(() => {
    try {
      const stored = localStorage.getItem("sidebarMode");
      return VALID_SIDEBAR_MODES.includes(stored) ? stored : "full";
    } catch {
      return "full";
    }
  });
  const prevVisibleMode = useRef(
    sidebarMode !== "hidden"
      ? sidebarMode
      : (() => { try { const s = localStorage.getItem("sidebarVisibleMode"); return s === "full" || s === "icons" ? s : "full"; } catch { return "full"; } })()
  );
  const location = useLocation();
  const { authRequired, logout, user } = useAuth();

  const isActive = useCallback(
    (path) => {
      if (path === "/discover" && location.pathname === "/") return true;
      return location.pathname === path;
    },
    [location.pathname],
  );

  const mobilePrimaryItems = useMemo(
    () => [
      { path: "/discover", label: "Discover", icon: Sparkles },
      { path: "/library", label: "Library", icon: Library },
      { path: "/requests", label: "Requests", icon: History },
    ],
    [],
  );

  const mobileOverflowItems = useMemo(() => {
    const items = [
      { path: "/shows", label: "Shows", icon: Ticket },
      {
        path: "/flow",
        label: "Flow",
        icon: AudioWaveform,
        permission: "accessFlow",
      },
      { path: "/blocklist", label: "Blocklist", icon: Ban },
      { path: "/settings", label: "Settings", icon: Settings },
    ];
    return items.filter(
      (item) =>
        !item.permission ||
        user?.role === "admin" ||
        !!user?.permissions?.[item.permission],
    );
  }, [user]);

  const handleSetSidebarMode = useCallback((newMode) => {
    if (newMode !== "hidden") {
      prevVisibleMode.current = newMode;
    }
    setSidebarMode(newMode);
    try {
      localStorage.setItem("sidebarMode", newMode);
      if (newMode !== "hidden") {
        localStorage.setItem("sidebarVisibleMode", newMode);
      }
    } catch {
      // localStorage unavailable
    }
  }, []);

  useEffect(() => {
    setIsSidebarOpen(false);
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen font-sans antialiased transition-colors duration-200">
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        appVersion={appVersion}
        mode={sidebarMode}
        onSetMode={handleSetSidebarMode}
      />

      <div
        className={`flex flex-col min-h-screen transition-all duration-300 ease-in-out ${
          sidebarMode === "full"
            ? "md:ml-[208px]"
            : sidebarMode === "icons"
              ? "md:ml-[56px]"
              : ""
        }`}
      >
        <header
          className="sticky top-0 z-30 flex h-16 items-center gap-4 px-4 py-3 backdrop-blur-md md:px-6"
          style={{ backgroundColor: "rgba(5, 5, 5, 0.8)" }}
        >
          <button
            onClick={() => {
              const isDesktop = window.matchMedia("(min-width: 768px)").matches;
              if (isDesktop) {
                handleSetSidebarMode(sidebarMode === "hidden" ? prevVisibleMode.current : "hidden");
              } else {
                setIsMobileMenuOpen((open) => !open);
              }
            }}
            className="hidden p-2 -ml-2 transition-colors hover:bg-gray-900/50 md:inline-flex"
            style={{ color: "#c1c1c3" }}
            aria-label="Toggle navigation"
          >
            <Menu className="w-5 h-5" />
          </button>

          <GlobalSearch />

          <div className="hidden items-center space-x-2 md:flex">
            <a
              href="https://github.com/lklynet/aurral"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 transition-colors rounded-md hover:bg-white/5 group"
              style={{ color: "#c1c1c3" }}
              aria-label="GitHub Repository"
            >
              <GitHubIcon className="w-5 h-5 transition-colors group-hover:text-white" />
            </a>
            <a
              href="https://github.com/sponsors/lklynet/"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 transition-colors rounded-md hover:bg-white/5 group"
              style={{ color: "#c1c1c3" }}
              aria-label="GitHub Sponsors"
            >
              <Heart className="w-5 h-5 transition-colors group-hover:text-pink-500" />
            </a>
          </div>
        </header>

        <main className="mx-auto flex-1 w-full max-w-[1600px] p-4 pb-24 md:p-8 md:pb-8 lg:p-10">
          <div className="animate-fade-in">{children}</div>
        </main>

        {isMobileMenuOpen && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 bg-black/50 md:hidden"
              onClick={() => setIsMobileMenuOpen(false)}
              aria-label="Close navigation menu"
            />
            <div
              className="fixed inset-x-0 bottom-20 z-50 mx-4 border border-white/10 p-2 shadow-2xl md:hidden"
              style={{ backgroundColor: "#14141a" }}
            >
              <nav className="flex flex-col">
                {mobileOverflowItems.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.path);
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className="flex items-center gap-3 px-3 py-3 text-sm font-medium transition-colors"
                      style={{ color: active ? "#fff" : "#c1c1c3" }}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
                {authRequired && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      logout();
                    }}
                    className="flex items-center gap-3 px-3 py-3 text-left text-sm font-medium"
                    style={{ color: "#c1c1c3" }}
                  >
                    <LogOut className="h-4 w-4" />
                    <span>Log out</span>
                  </button>
                )}
              </nav>
            </div>
          </>
        )}

        <nav
          className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0f0f12] md:hidden"
          aria-label="Mobile navigation"
        >
          <div className="grid min-h-[88px] grid-cols-4">
            {mobilePrimaryItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.path);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className="flex flex-col items-center justify-start gap-1.5 px-2 pt-3 pb-4 text-xs font-medium"
                  style={{ color: active ? "#fff" : "#8f9097" }}
                >
                  <Icon className="h-6 w-6" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen((open) => !open)}
              className="flex flex-col items-center justify-start gap-1.5 px-2 pt-3 pb-4 text-xs font-medium"
              style={{
                color:
                  isMobileMenuOpen ||
                  mobileOverflowItems.some((item) => isActive(item.path))
                    ? "#fff"
                    : "#8f9097",
              }}
              aria-label="More navigation options"
              aria-expanded={isMobileMenuOpen}
            >
              <Ellipsis className="h-6 w-6" />
              <span>More</span>
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}

Layout.propTypes = {
  children: PropTypes.node.isRequired,
  appVersion: PropTypes.string,
};

export default Layout;
