import { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const normalizeBasePath = (baseUrl) => {
  const raw = (baseUrl || "/").trim();
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  if (withLeadingSlash === "/") return "/";
  return withLeadingSlash.endsWith("/")
    ? withLeadingSlash.slice(0, -1)
    : withLeadingSlash;
};

const stripBasePath = (href, basePath) => {
  if (basePath === "/") return href;
  if (href === basePath) return "/";
  if (href.startsWith(`${basePath}/`)) {
    return href.slice(basePath.length) || "/";
  }
  return href;
};

export function useUnsavedGuard(hasUnsavedChanges, setHasUnsavedChanges) {
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();
  const hasUnsavedChangesRef = useRef(false);
  const basePath = normalizeBasePath(
    import.meta.env.VITE_BASE_PATH || import.meta.env.BASE_URL,
  );
  const settingsPath = basePath === "/" ? "/settings" : `${basePath}/settings`;
  const isSettingsRoute = (path) => path === "/settings" || path.startsWith("/settings/");

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      return;
    }

    const handleClick = (e) => {
      const link = e.target.closest("a[href]");
      const href = link?.getAttribute("href");
      if (
        link &&
        href?.startsWith("/") &&
        !isSettingsRoute(stripBasePath(href, basePath))
      ) {
        e.preventDefault();
        e.stopPropagation();
        const targetPath = stripBasePath(href, basePath);
        setShowUnsavedModal(true);
        setPendingNavigation(() => () => {
          navigate(targetPath);
          if (hasUnsavedChangesRef.current === false) return;
        });
        return false;
      }
    };

    const handlePopState = () => {
      if (isSettingsRoute(location.pathname)) {
        window.history.pushState(null, "", settingsPath);
        setShowUnsavedModal(true);
        setPendingNavigation(() => () => {
          window.history.back();
        });
      }
    };

    document.addEventListener("click", handleClick, true);
    window.addEventListener("popstate", handlePopState);
    return () => {
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [hasUnsavedChanges, location.pathname, navigate, basePath, settingsPath]);

  const handleConfirmLeave = () => {
    setHasUnsavedChanges?.(false);
    if (pendingNavigation) {
      pendingNavigation();
    }
    setShowUnsavedModal(false);
    setPendingNavigation(null);
  };

  const handleCancelLeave = () => {
    setShowUnsavedModal(false);
    setPendingNavigation(null);
  };

  return {
    showUnsavedModal,
    handleConfirmLeave,
    handleCancelLeave,
  };
}
