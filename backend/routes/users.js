import express from "express";
import bcrypt from "bcrypt";
import { userOps, dbOps } from "../config/db-helpers.js";
import { requireAuth, requireAdmin } from "../middleware/requirePermission.js";
import { requirePasswordStrength } from "../middleware/validation.js";
import { deleteSessionsByUserId } from "../config/session-helpers.js";
import {
  getListenHistoryCacheNamespace,
  getListenHistoryProfile,
  hasListenHistoryProfile,
  listenHistoryProfilesEqual,
} from "../services/listeningHistory.js";

const router = express.Router();

const normalizeRootFolderPath = (value) => {
  const normalized = String(value || "").trim();
  return normalized || null;
};

const normalizeQualityProfileId = (value) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.trunc(parsed);
};

const DEFAULT_DISCOVER_LAYOUT = [
  { id: "recentlyAdded", enabled: true },
  { id: "recommendedShows", enabled: true },
  { id: "recentReleases", enabled: true },
  { id: "recommended", enabled: true },
  { id: "globalTop", enabled: true },
  { id: "genreSections", enabled: true },
  { id: "topTags", enabled: true },
];

const normalizeDiscoverLayout = (value) => {
  if (!Array.isArray(value)) return null;
  const defaultsById = new Map(
    DEFAULT_DISCOVER_LAYOUT.map((item) => [item.id, item]),
  );
  const normalized = [];
  for (const item of value) {
    const id = String(item?.id || "").trim();
    if (!id || !defaultsById.has(id)) continue;
    normalized.push({
      id,
      enabled:
        typeof item?.enabled === "boolean"
          ? item.enabled
          : defaultsById.get(id).enabled,
    });
    defaultsById.delete(id);
  }
  for (const item of defaultsById.values()) {
    normalized.push({ ...item });
  }
  return normalized;
};

const clearOrphanedDiscoveryCache = (userId, existingProfile, nextProfile) => {
  if (
    !hasListenHistoryProfile(existingProfile) ||
    listenHistoryProfilesEqual(existingProfile, nextProfile)
  ) {
    return;
  }
  const existingNamespace = getListenHistoryCacheNamespace(existingProfile);
  if (!existingNamespace) return;
  const otherUsers = userOps
    .getAllListeningHistoryUsers()
    .filter(
      (user) =>
        user.id !== userId && listenHistoryProfilesEqual(user, existingProfile),
    );
  if (otherUsers.length === 0) {
    dbOps.deleteDiscoveryCacheByPrefix(`${existingNamespace}:`);
  }
};

router.get("/", requireAuth, requireAdmin, (req, res) => {
  try {
    const users = userOps.getAllUsers();
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: "Failed to list users", message: e.message });
  }
});

router.post("/", requireAuth, requireAdmin, (req, res) => {
  try {
    const { username, password, role = "user", permissions } = req.body;
    const un = String(username || "").trim();
    if (!un || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }
    if (userOps.getUserByUsername(un)) {
      return res.status(409).json({ error: "Username already exists" });
    }
    const passwordValidation = requirePasswordStrength(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({ error: passwordValidation.error });
    }
    const hash = bcrypt.hashSync(password, 10);
    const perms = permissions
      ? { ...userOps.getDefaultPermissions(), ...permissions }
      : null;
    const created = userOps.createUser(un, hash, role, perms);
    if (!created) {
      return res.status(500).json({ error: "Failed to create user" });
    }
    res
      .status(201)
      .json({
        id: created.id,
        username: created.username,
        role: created.role,
        permissions: created.permissions,
        lidarrRootFolderPath: created.lidarrRootFolderPath,
        lidarrQualityProfileId: created.lidarrQualityProfileId,
        discoverLayout: created.discoverLayout,
      });
  } catch (e) {
    res
      .status(500)
      .json({ error: "Failed to create user", message: e.message });
  }
});

router.patch("/:id", requireAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const isAdmin = req.user.role === "admin";
    const isSelf = req.user.id === id;
    if (!isAdmin && !isSelf) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const existing = userOps.getUserById(id);
    if (!existing) {
      return res.status(404).json({ error: "User not found" });
    }
    const { password, permissions, role } = req.body;
    const hasLegacyLastfmUpdate = Object.hasOwn(req.body, "lastfmUsername");
    const hasListenHistoryProviderUpdate = Object.hasOwn(
      req.body,
      "listenHistoryProvider",
    );
    const hasListenHistoryUsernameUpdate = Object.hasOwn(
      req.body,
      "listenHistoryUsername",
    );
    const existingProfile = getListenHistoryProfile(existing);
    const requestedProfile = getListenHistoryProfile({
      listenHistoryProvider: hasListenHistoryProviderUpdate
        ? req.body.listenHistoryProvider
        : hasLegacyLastfmUpdate
          ? "lastfm"
          : existing.listenHistoryProvider,
      listenHistoryUsername: hasListenHistoryUsernameUpdate
        ? req.body.listenHistoryUsername
        : hasLegacyLastfmUpdate
          ? req.body.lastfmUsername
          : existing.listenHistoryUsername,
    });
    clearOrphanedDiscoveryCache(id, existingProfile, requestedProfile);
    if (isSelf && !isAdmin) {
      if (permissions !== undefined || role !== undefined) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const updates = {};
      if (hasListenHistoryProviderUpdate || hasListenHistoryUsernameUpdate) {
        updates.listenHistoryProvider = req.body.listenHistoryProvider;
        updates.listenHistoryUsername = req.body.listenHistoryUsername;
      } else if (hasLegacyLastfmUpdate) {
        updates.lastfmUsername = req.body.lastfmUsername;
      }
      if (password) {
        const { currentPassword } = req.body;
        if (!currentPassword) {
          return res
            .status(400)
            .json({ error: "currentPassword required to change password" });
        }
        if (!bcrypt.compareSync(currentPassword, existing.passwordHash)) {
          return res.status(401).json({ error: "Current password is incorrect" });
        }
        const passwordValidation = requirePasswordStrength(password);
        if (!passwordValidation.valid) {
          return res.status(400).json({ error: passwordValidation.error });
        }
        updates.passwordHash = bcrypt.hashSync(password, 10);
      }
      if (Object.keys(updates).length === 0) {
        return res.json({
          id,
          username: existing.username,
          role: existing.role,
          listenHistoryProvider: existing.listenHistoryProvider,
          listenHistoryUsername: existing.listenHistoryUsername,
          lastfmUsername: existing.lastfmUsername,
          lidarrRootFolderPath: existing.lidarrRootFolderPath,
          lidarrQualityProfileId: existing.lidarrQualityProfileId,
          discoverLayout: existing.discoverLayout,
        });
      }
      const updated = userOps.updateUser(id, updates);
      if (updates.passwordHash) {
        deleteSessionsByUserId(id);
      }
      return res.json(updated);
    }
    const updates = {};
    if (password) {
      const passwordValidation = requirePasswordStrength(password);
      if (!passwordValidation.valid) {
        return res.status(400).json({ error: passwordValidation.error });
      }
      updates.passwordHash = bcrypt.hashSync(password, 10);
    }
    if (permissions !== undefined) updates.permissions = permissions;
    if (role !== undefined) updates.role = role;
    if (hasListenHistoryProviderUpdate || hasListenHistoryUsernameUpdate) {
      if (hasListenHistoryProviderUpdate) {
        updates.listenHistoryProvider = req.body.listenHistoryProvider;
      }
      if (hasListenHistoryUsernameUpdate) {
        updates.listenHistoryUsername = req.body.listenHistoryUsername;
      }
    } else if (hasLegacyLastfmUpdate) {
      updates.lastfmUsername = req.body.lastfmUsername;
    }
    if (Object.keys(updates).length === 0) {
      return res.json({
        id: existing.id,
        username: existing.username,
        role: existing.role,
        permissions: existing.permissions,
        listenHistoryProvider: existing.listenHistoryProvider,
        listenHistoryUsername: existing.listenHistoryUsername,
        lastfmUsername: existing.lastfmUsername,
        lidarrRootFolderPath: existing.lidarrRootFolderPath,
        lidarrQualityProfileId: existing.lidarrQualityProfileId,
        discoverLayout: existing.discoverLayout,
      });
    }
    const updated = userOps.updateUser(id, updates);
    res.json(updated);
  } catch (e) {
    res
      .status(500)
      .json({ error: "Failed to update user", message: e.message });
  }
});

const sendListenHistorySettings = (req, res) => {
  try {
    const user = userOps.getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({
      listenHistoryProvider: user.listenHistoryProvider,
      listenHistoryUsername: user.listenHistoryUsername,
      lastfmUsername: user.lastfmUsername,
    });
  } catch (e) {
    res.status(500).json({
      error: "Failed to get listening history settings",
      message: e.message,
    });
  }
};

router.get("/me/listening-history", requireAuth, sendListenHistorySettings);
router.get("/me/lastfm", requireAuth, sendListenHistorySettings);

router.get("/me/lidarr-preferences", requireAuth, async (req, res) => {
  try {
    const user = userOps.getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    const { lidarrClient } = await import("../services/lidarrClient.js");
    const summary = await lidarrClient.getArtistAddPreferenceSummary(user);
    res.json(summary);
  } catch (e) {
    res.status(500).json({
      error: "Failed to get Lidarr preferences",
      message: e.message,
    });
  }
});

router.get("/me/discover-layout", requireAuth, (req, res) => {
  try {
    const user = userOps.getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    const storedLayout = dbOps.getUserDiscoverLayout(req.user.id);
    res.json({
      layout: normalizeDiscoverLayout(storedLayout),
    });
  } catch (e) {
    res.status(500).json({
      error: "Failed to get discover layout",
      message: e.message,
    });
  }
});

router.patch("/me/discover-layout", requireAuth, (req, res) => {
  try {
    const user = userOps.getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    const normalized = normalizeDiscoverLayout(req.body?.layout);
    if (!normalized) {
      return res.status(400).json({
        error: "Invalid discover layout",
        message: "layout must be an array of discover section entries",
        field: "layout",
      });
    }
    dbOps.setUserDiscoverLayout(req.user.id, normalized);
    res.json({
      layout: normalizeDiscoverLayout(dbOps.getUserDiscoverLayout(req.user.id)),
    });
  } catch (e) {
    res.status(500).json({
      error: "Failed to save discover layout",
      message: e.message,
    });
  }
});

router.patch("/me/lidarr-preferences", requireAuth, async (req, res) => {
  try {
    const user = userOps.getUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const hasRootFolderPath = Object.hasOwn(req.body, "rootFolderPath");
    const hasQualityProfileId = Object.hasOwn(req.body, "qualityProfileId");

    const nextRootFolderPath = hasRootFolderPath
      ? req.body.rootFolderPath === null
        ? null
        : normalizeRootFolderPath(req.body.rootFolderPath)
      : user.lidarrRootFolderPath;
    const nextQualityProfileId = hasQualityProfileId
      ? req.body.qualityProfileId === null
        ? null
        : normalizeQualityProfileId(req.body.qualityProfileId)
      : user.lidarrQualityProfileId;

    if (hasRootFolderPath && req.body.rootFolderPath !== null && !nextRootFolderPath) {
      return res.status(400).json({
        error: "Invalid Lidarr preferences",
        message: "rootFolderPath must be a non-empty string or null",
        field: "rootFolderPath",
      });
    }

    if (
      hasQualityProfileId &&
      req.body.qualityProfileId !== null &&
      nextQualityProfileId === null
    ) {
      return res.status(400).json({
        error: "Invalid Lidarr preferences",
        message: "qualityProfileId must be a numeric id or null",
        field: "qualityProfileId",
      });
    }

    const { lidarrClient } = await import("../services/lidarrClient.js");
    if (!lidarrClient.isConfigured()) {
      if (nextRootFolderPath !== null || nextQualityProfileId !== null) {
        return res.status(503).json({
          error: "Lidarr is not configured",
          message: "Configure Lidarr before saving library defaults.",
        });
      }
      const updated = userOps.updateUser(req.user.id, {
        lidarrRootFolderPath: null,
        lidarrQualityProfileId: null,
      });
      return res.json({
        configured: false,
        rootFolders: [],
        qualityProfiles: [],
        savedDefaults: {
          rootFolderPath: updated?.lidarrRootFolderPath || null,
          qualityProfileId: updated?.lidarrQualityProfileId ?? null,
        },
        fallbacks: {
          rootFolderPath: null,
          qualityProfileId: null,
        },
      });
    }

    const summary = await lidarrClient.getArtistAddPreferenceSummary(user);
    if (
      nextRootFolderPath !== null &&
      !summary.rootFolders.some((folder) => folder.path === nextRootFolderPath)
    ) {
      return res.status(400).json({
        error: "Invalid Lidarr preferences",
        message: `Unknown Lidarr root folder: ${nextRootFolderPath}`,
        field: "rootFolderPath",
      });
    }
    if (
      nextQualityProfileId !== null &&
      !summary.qualityProfiles.some(
        (profile) => profile.id === nextQualityProfileId,
      )
    ) {
      return res.status(400).json({
        error: "Invalid Lidarr preferences",
        message: `Unknown Lidarr quality profile: ${nextQualityProfileId}`,
        field: "qualityProfileId",
      });
    }

    const updated = userOps.updateUser(req.user.id, {
      lidarrRootFolderPath: nextRootFolderPath,
      lidarrQualityProfileId: nextQualityProfileId,
    });
    if (!updated) {
      return res.status(500).json({
        error: "Failed to save Lidarr preferences",
      });
    }

    const refreshedSummary = await lidarrClient.getArtistAddPreferenceSummary(
      updated,
    );
    res.json(refreshedSummary);
  } catch (e) {
    res.status(500).json({
      error: "Failed to save Lidarr preferences",
      message: e.message,
    });
  }
});

router.post("/me/password", requireAuth, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword) {
      return res.status(400).json({ error: "New password required" });
    }
    const passwordValidation = requirePasswordStrength(newPassword);
    if (!passwordValidation.valid) {
      return res.status(400).json({ error: passwordValidation.error });
    }
    const u = userOps.getUserById(req.user.id);
    if (!u || !bcrypt.compareSync(currentPassword || "", u.passwordHash)) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
    const hash = bcrypt.hashSync(newPassword, 10);
    userOps.updateUser(req.user.id, { passwordHash: hash });
    deleteSessionsByUserId(req.user.id);
    res.json({ success: true });
  } catch (e) {
    res
      .status(500)
      .json({ error: "Failed to change password", message: e.message });
  }
});

router.delete("/:id", requireAuth, requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (req.user.id === id) {
      return res.status(400).json({ error: "Cannot delete your own account" });
    }
    const existing = userOps.getUserById(id);
    if (!existing) {
      return res.status(404).json({ error: "User not found" });
    }
    deleteSessionsByUserId(id);
    userOps.deleteUser(id);
    res.json({ success: true });
  } catch (e) {
    res
      .status(500)
      .json({ error: "Failed to delete user", message: e.message });
  }
});

export default router;
