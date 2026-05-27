import { dbOps } from '../config/db-helpers.js';
import { isVerboseConsoleEnabled } from '../loadEnv.js';

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4,
};

const LOG_LEVEL_NAMES = {
  0: 'debug',
  1: 'info',
  2: 'warn',
  3: 'error',
};

class Logger {
  constructor() {
    this.level = isVerboseConsoleEnabled() ? LOG_LEVELS.DEBUG : LOG_LEVELS.INFO;
    this.persistToDb = true;
    this.maxDbEntries = 1000;
    this.categories = new Map();
    this.listeners = new Set();
  }

  setLevel(level) {
    if (typeof level === 'string') {
      const levelUpper = level.toUpperCase();
      if (LOG_LEVELS[levelUpper] !== undefined) {
        this.level = LOG_LEVELS[levelUpper];
      }
    } else if (typeof level === 'number') {
      this.level = level;
    }
    console.log(`[Logger] Log level set to ${LOG_LEVEL_NAMES[this.level] || 'unknown'}`);
  }

  setCategoryLevel(category, level) {
    if (typeof level === 'string') {
      const levelUpper = level.toUpperCase();
      if (LOG_LEVELS[levelUpper] !== undefined) {
        this.categories.set(category, LOG_LEVELS[levelUpper]);
      }
    } else if (typeof level === 'number') {
      this.categories.set(category, level);
    }
  }

  shouldLog(level, category = null) {
    if (category && this.categories.has(category)) {
      return level >= this.categories.get(category);
    }
    return level >= this.level;
  }

  formatMessage(level, category, message, data = {}) {
    const timestamp = new Date().toISOString();
    const levelName = LOG_LEVEL_NAMES[level] || 'unknown';
    
    return {
      timestamp,
      level: levelName,
      category,
      message,
      data,
    };
  }

  log(level, category, message, data = {}) {
    if (!this.shouldLog(level, category)) {
      return;
    }

    const entry = this.formatMessage(level, category, message, data);

    const consoleMessage = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${category}] ${message}`;
    switch (level) {
      case LOG_LEVELS.DEBUG:
        console.debug(consoleMessage, Object.keys(data).length > 0 ? data : '');
        break;
      case LOG_LEVELS.INFO:
        console.log(consoleMessage, Object.keys(data).length > 0 ? data : '');
        break;
      case LOG_LEVELS.WARN:
        console.warn(consoleMessage, Object.keys(data).length > 0 ? data : '');
        break;
      case LOG_LEVELS.ERROR:
        console.error(consoleMessage, Object.keys(data).length > 0 ? data : '');
        break;
    }

    if (this.persistToDb && level >= LOG_LEVELS.INFO) {
      try {
        dbOps.insertActivityLog(entry);
      } catch (err) {
      }
    }

    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch (err) {
      }
    }
  }

  debug(category, message, data = {}) {
    this.log(LOG_LEVELS.DEBUG, category, message, data);
  }

  info(category, message, data = {}) {
    this.log(LOG_LEVELS.INFO, category, message, data);
  }

  warn(category, message, data = {}) {
    this.log(LOG_LEVELS.WARN, category, message, data);
  }

  error(category, message, data = {}) {
    this.log(LOG_LEVELS.ERROR, category, message, data);
  }

  download(level, message, downloadId, data = {}) {
    this.log(level, 'download', message, { downloadId, ...data });
  }

  library(level, message, data = {}) {
    this.log(level, 'library', message, data);
  }

  discovery(level, message, data = {}) {
    this.log(level, 'discovery', message, data);
  }

  api(level, message, data = {}) {
    this.log(level, 'api', message, data);
  }

  slskd(level, message, data = {}) {
    this.log(level, 'slskd', message, data);
  }

  system(level, message, data = {}) {
    this.log(level, 'system', message, data);
  }

  addListener(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  removeListener(listener) {
    this.listeners.delete(listener);
  }

  getRecentLogs(options = {}) {
    const { limit = 100, category = null, level = null } = options;
    return dbOps.getActivityLog(limit, category, level);
  }

  getLogStats() {
    const logs = dbOps.getActivityLog(1000);
    
    const byLevel = { debug: 0, info: 0, warn: 0, error: 0 };
    const byCategory = {};
    const lastHour = Date.now() - 60 * 60 * 1000;
    let recentCount = 0;

    for (const log of logs) {
      byLevel[log.level] = (byLevel[log.level] || 0) + 1;
      byCategory[log.category] = (byCategory[log.category] || 0) + 1;
      
      if (new Date(log.timestamp).getTime() > lastHour) {
        recentCount++;
      }
    }

    return {
      total: logs.length,
      lastHour: recentCount,
      byLevel,
      byCategory,
      currentLevel: LOG_LEVEL_NAMES[this.level],
      persistToDb: this.persistToDb,
    };
  }

  child(defaultCategory) {
    const parentLogger = this;
    return {
      debug: (message, data = {}) => parentLogger.debug(defaultCategory, message, data),
      info: (message, data = {}) => parentLogger.info(defaultCategory, message, data),
      warn: (message, data = {}) => parentLogger.warn(defaultCategory, message, data),
      error: (message, data = {}) => parentLogger.error(defaultCategory, message, data),
      log: (level, message, data = {}) => parentLogger.log(level, defaultCategory, message, data),
    };
  }
}

export const logger = new Logger();

export const LOG_LEVELS_EXPORT = LOG_LEVELS;
