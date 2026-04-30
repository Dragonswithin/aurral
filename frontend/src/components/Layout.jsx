import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import PropTypes from "prop-types";
import { Link, useLocation } from "react-router-dom";
import {
  Menu,
  Github,
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
              <Github className="w-5 h-5 transition-colors group-hover:text-white" />
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
