document.addEventListener("DOMContentLoaded", async () => {
  const syncScrolledState = () => {
    document.body.classList.toggle("is-scrolled", window.scrollY > 12);
  };

  document.querySelectorAll("[data-copy-target]").forEach((button) => {
    button.addEventListener("click", async () => {
      const targetId = button.getAttribute("data-copy-target");
      const target = targetId ? document.getElementById(targetId) : null;
      const text = target?.textContent;
      if (!text) return;

      try {
        await navigator.clipboard.writeText(text);
        const originalLabel = button.textContent;
        button.textContent = "Copied";
        window.setTimeout(() => {
          button.textContent = originalLabel;
        }, 1500);
      } catch (error) {
        console.error("Failed to copy snippet:", error);
      }
    });
  });

  document.querySelectorAll("[data-tabs]").forEach((tabsRoot) => {
    const tabs = Array.from(tabsRoot.querySelectorAll("[data-tab-target]"));
    const panels = Array.from(tabsRoot.querySelectorAll(".json-panel"));

    const activateTab = (nextTab) => {
      const targetId = nextTab.getAttribute("data-tab-target");
      tabs.forEach((tab) => {
        const isActive = tab === nextTab;
        tab.classList.toggle("is-active", isActive);
        tab.setAttribute("aria-selected", String(isActive));
      });

      panels.forEach((panel) => {
        const isActive = panel.id === targetId;
        panel.classList.toggle("is-active", isActive);
        panel.hidden = !isActive;
      });
    };

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => activateTab(tab));
    });
  });

  window.addEventListener("scroll", syncScrolledState, { passive: true });
  syncScrolledState();

  try {
    const res = await fetch("https://api.github.com/repos/lklynet/aurral");
    if (!res.ok) return;

    const data = await res.json();
    if (data.stargazers_count !== undefined) {
      const formattedStars = new Intl.NumberFormat("en-US").format(
        data.stargazers_count,
      );

      document.querySelectorAll(".github-stars-count").forEach((el) => {
        el.textContent = formattedStars;
      });

      document.querySelectorAll(".github-stars-badge").forEach((el) => {
        el.style.display = "inline-flex";
      });
    }
  } catch (error) {
    console.error("Failed to fetch GitHub stars:", error);
  }
});
