import { WebSocketServer } from 'ws';
import { dbOps, userOps } from "../config/db-helpers.js";
import {
  getAuthPassword,
  isProxyAuthEnabled,
  resolveLocalNetworkBypassUser,
  resolveSessionUserFromToken,
} from "../middleware/auth.js";

const isAuthRequired = () => {
  const settings = dbOps.getSettings();
  if (!settings.onboardingComplete) return false;
  const users = userOps.getAllUsers();
  const legacyPasswords = getAuthPassword();
  return isProxyAuthEnabled() || users.length > 0 || legacyPasswords.length > 0;
};

class WebSocketService {
  constructor() {
    this.wss = null;
    this.clients = new Set();
    this.subscriptions = new Map();
    this.startTime = Date.now();
  }

  initialize(server) {
    this.startTime = Date.now();
    this.wss = new WebSocketServer({ 
      server,
      path: '/ws',
    });

    this.wss.on('connection', (ws, req) => {
      this.handleConnection(ws, req);
    });

    console.log('[WebSocket] Server initialized on /ws');
    return this;
  }

  handleConnection(ws, req) {
    let sessionUser = null;
    let authSource = null;
    if (isAuthRequired()) {
      const requestUrl = new URL(req.url || "", "http://localhost");
      const token = requestUrl.searchParams.get("token");
      sessionUser = resolveSessionUserFromToken(token);
      if (sessionUser) {
        authSource = "session";
      } else {
        sessionUser = resolveLocalNetworkBypassUser({
          headers: req.headers || {},
          socket: req.socket || {},
          connection: req.connection || {},
          ip: req.socket?.remoteAddress || "",
          ips: [],
        });
        if (sessionUser) {
          authSource = "local-network-bypass";
        }
      }
      if (!sessionUser) {
        ws.close(4401, "Unauthorized");
        return;
      }
    }

    const clientId = this.generateClientId();
    
    const client = {
      id: clientId,
      ws,
      user: sessionUser,
      authSource,
      subscriptions: new Set(['status']),
      connectedAt: Date.now(),
    };

    this.clients.add(client);
    console.log(`[WebSocket] Client connected: ${clientId} (total: ${this.clients.size})`);

    ws.on('message', (message) => {
      this.handleMessage(client, message);
    });

    ws.on('close', () => {
      this.clients.delete(client);
      console.log(`[WebSocket] Client disconnected: ${clientId} (total: ${this.clients.size})`);
    });

    ws.on('error', (error) => {
      console.error(`[WebSocket] Client error ${clientId}:`, error.message);
      this.clients.delete(client);
    });

    this.send(client, {
      type: 'connected',
      clientId,
      subscriptions: Array.from(client.subscriptions),
    });
  }

  handleMessage(client, rawMessage) {
    try {
      const message = JSON.parse(rawMessage.toString());

      switch (message.type) {
        case 'subscribe':
          this.handleSubscribe(client, message.channels || []);
          break;
        case 'unsubscribe':
          this.handleUnsubscribe(client, message.channels || []);
          break;
        case 'ping':
          this.send(client, { type: 'pong', timestamp: Date.now() });
          break;
        default:
          console.log(`[WebSocket] Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error('[WebSocket] Failed to parse message:', error.message);
    }
  }

  handleSubscribe(client, channels) {
    for (const channel of channels) {
      client.subscriptions.add(channel);
    }
    
    this.send(client, {
      type: 'subscribed',
      channels,
      subscriptions: Array.from(client.subscriptions),
    });
  }

  handleUnsubscribe(client, channels) {
    for (const channel of channels) {
      client.subscriptions.delete(channel);
    }
    
    this.send(client, {
      type: 'unsubscribed',
      channels,
      subscriptions: Array.from(client.subscriptions),
    });
  }

  send(client, data) {
    if (client.ws.readyState === 1) {
      client.ws.send(JSON.stringify(data));
    }
  }

  broadcast(channel, data) {
    const message = JSON.stringify({
      channel,
      timestamp: Date.now(),
      ...data,
    });

    let sent = 0;
    for (const client of this.clients) {
      if (client.subscriptions.has(channel) || client.subscriptions.has('*')) {
        if (client.ws.readyState === 1) {
          client.ws.send(message);
          sent++;
        }
      }
    }

    return sent;
  }

  broadcastPerClient(channel, buildData) {
    let sent = 0;
    for (const client of this.clients) {
      if (!(client.subscriptions.has(channel) || client.subscriptions.has('*'))) {
        continue;
      }
      if (client.ws.readyState !== 1) {
        continue;
      }
      const payload = buildData(client);
      if (!payload) {
        continue;
      }
      client.ws.send(
        JSON.stringify({
          channel,
          timestamp: Date.now(),
          ...payload,
        }),
      );
      sent++;
    }
    return sent;
  }

  broadcastToAll(data) {
    const message = JSON.stringify({
      timestamp: Date.now(),
      ...data,
    });

    let sent = 0;
    for (const client of this.clients) {
      if (client.ws.readyState === 1) {
        client.ws.send(message);
        sent++;
      }
    }

    return sent;
  }

  emitDownloadProgress(downloadId, progress) {
    this.broadcast('downloads', {
      type: 'download_progress',
      downloadId,
      ...progress,
    });
  }

  emitDownloadStateChange(downloadId, fromState, toState, metadata = {}) {
    this.broadcast('downloads', {
      type: 'download_state_change',
      downloadId,
      fromState,
      toState,
      ...metadata,
    });
  }

  emitDownloadComplete(downloadId, result) {
    this.broadcast('downloads', {
      type: 'download_complete',
      downloadId,
      ...result,
    });
  }

  reconcileAuthState() {
    for (const client of this.clients) {
      if (client.authSource !== "local-network-bypass") {
        continue;
      }
      if (client.ws.readyState !== 1) {
        continue;
      }
      try {
        client.ws.close(4401, "Unauthorized");
      } catch {}
    }
  }

  emitDownloadFailed(downloadId, error) {
    this.broadcast('downloads', {
      type: 'download_failed',
      downloadId,
      error: error?.message || String(error),
    });
  }

  emitQueueUpdate(queueStatus) {
    this.broadcast('queue', {
      type: 'queue_update',
      ...queueStatus,
    });
  }

  emitLibraryUpdate(event, data) {
    this.broadcast('library', {
      type: 'library_update',
      event,
      ...data,
    });
  }

  emitDiscoveryUpdate(data) {
    this.broadcast('discovery', {
      type: 'discovery_update',
      ...data,
    });
  }

  emitNotification(level, message, data = {}) {
    this.broadcast('notifications', {
      type: 'notification',
      level,
      message,
      ...data,
    });
  }

  getStats() {
    const channelStats = {};
    for (const client of this.clients) {
      for (const channel of client.subscriptions) {
        channelStats[channel] = (channelStats[channel] || 0) + 1;
      }
    }

    return {
      totalClients: this.clients.size,
      channels: channelStats,
      uptime: this.wss ? Date.now() - this.startTime : 0,
    };
  }

  generateClientId() {
    return `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  close() {
    if (this.wss) {
      for (const client of this.clients) {
        client.ws.close();
      }
      this.clients.clear();
      this.wss.close();
      this.wss = null;
    }
  }
}

export const websocketService = new WebSocketService();
