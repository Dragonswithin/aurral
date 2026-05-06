import { useState, useEffect, useRef, useMemo } from "react";
import { Server, Compass, Bell, Users, User } from "lucide-react";

export function useSettingsTabs(authUser) {
  const isAdmin = authUser?.role === "admin";
  const [activeTab, setActiveTab] = useState(isAdmin ? "integrations" : "account");
  const [hoveredTabIndex, setHoveredTabIndex] = useState(null);
  const tabsRef = useRef(null);
  const activeBubbleRef = useRef(null);
  const hoverBubbleRef = useRef(null);
  const tabRefs = useRef({});

  const tabs = useMemo(() => {
    const adminTabs = [
      { id: "integrations", label: "Integrations", icon: Server },
      { id: "discover", label: "Discover", icon: Compass },
      { id: "notifications", label: "Notifications", icon: Bell },
      { id: "users", label: "Users", icon: Users },
    ];
    const userTabs = [
      { id: "account", label: "Account", icon: User },
    ];
    if (authUser?.role !== "admin") {
      return userTabs;
    }
    return [...adminTabs, ...userTabs];
  }, [authUser?.role]);

  useEffect(() => {
    const validIds = tabs.map((t) => t.id);
    if (!validIds.includes(activeTab)) {
      setActiveTab(validIds[0] || "users");
    }
  }, [tabs, activeTab]);

  useEffect(() => {
    const updateActiveBubble = () => {
      if (!tabsRef.current || !activeBubbleRef.current) return;
      const activeIndex = tabs.findIndex((tab) => tab.id === activeTab);
      if (activeIndex === -1) {
        activeBubbleRef.current.style.opacity = "0";
        return;
      }
      const activeTabEl = tabRefs.current[activeIndex];
      if (!activeTabEl) {
        setTimeout(updateActiveBubble, 50);
        return;
      }
      const tabsRect = tabsRef.current.getBoundingClientRect();
      const tabRect = activeTabEl.getBoundingClientRect();
      activeBubbleRef.current.style.left = `${tabRect.left - tabsRect.left}px`;
      activeBubbleRef.current.style.top = `${tabRect.top - tabsRect.top}px`;
      activeBubbleRef.current.style.width = `${tabRect.width}px`;
      activeBubbleRef.current.style.height = `${tabRect.height}px`;
      activeBubbleRef.current.style.opacity = "1";
    };
    const timeoutId = setTimeout(updateActiveBubble, 10);
    window.addEventListener("resize", updateActiveBubble);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener("resize", updateActiveBubble);
    };
  }, [activeTab, tabs]);

  useEffect(() => {
    const updateHoverBubble = () => {
      if (!tabsRef.current || !hoverBubbleRef.current) return;
      if (hoveredTabIndex === null) {
        hoverBubbleRef.current.style.left = "0px";
        hoverBubbleRef.current.style.top = "0px";
        hoverBubbleRef.current.style.width = "100%";
        hoverBubbleRef.current.style.height = "100%";
        hoverBubbleRef.current.style.opacity = "0.6";
        return;
      }
      const hoveredTabEl = tabRefs.current[hoveredTabIndex];
      if (!hoveredTabEl) return;
      const tabsRect = tabsRef.current.getBoundingClientRect();
      const tabRect = hoveredTabEl.getBoundingClientRect();
      hoverBubbleRef.current.style.left = `${tabRect.left - tabsRect.left}px`;
      hoverBubbleRef.current.style.top = `${tabRect.top - tabsRect.top}px`;
      hoverBubbleRef.current.style.width = `${tabRect.width}px`;
      hoverBubbleRef.current.style.height = `${tabRect.height}px`;
      hoverBubbleRef.current.style.opacity = "1";
    };
    updateHoverBubble();
  }, [hoveredTabIndex]);

  return {
    activeTab,
    setActiveTab,
    tabs,
    hoveredTabIndex,
    setHoveredTabIndex,
    tabsRef,
    activeBubbleRef,
    hoverBubbleRef,
    tabRefs,
  };
}
