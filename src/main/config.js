'use strict';

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

function getDefaultConfig() {
  return {
    version: '0.0.1',
    app: {
      autoStart: false,
      // 'tray' = 点关闭按钮最小化到托盘；'quit' = 直接退出
      closeAction: 'tray',
    },
    theme: {
      mode: 'light',
      accentColor: '#6200EE',
    },
    window: {
      width: 950,
      height: 600,
      maximised: false,
    },
    advanced: {
      logLevel: 'info',
      debugMode: false,
    },
  };
}

class ConfigManager {
  constructor() {
    this.configPath = '';
    this.config = getDefaultConfig();
  }

  initialize() {
    const appConfigDir = path.join(app.getPath('userData'));
    fs.mkdirSync(appConfigDir, { recursive: true });
    this.configPath = path.join(appConfigDir, 'config.json');

    if (!fs.existsSync(this.configPath)) {
      this.save();
    } else {
      this.load();
    }
  }

  load() {
    try {
      const data = fs.readFileSync(this.configPath, 'utf8');
      this.config = { ...getDefaultConfig(), ...JSON.parse(data) };
    } catch {
      this.config = getDefaultConfig();
    }
  }

  save() {
    if (!this.configPath) {
      return;
    }
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
  }

  getConfigJSON() {
    return JSON.stringify(this.config, null, 2);
  }

  updateConfig(jsonStr) {
    const parsed = JSON.parse(jsonStr);
    this.config = { ...getDefaultConfig(), ...parsed };
    this.save();
  }

  getConfigPath() {
    return this.configPath;
  }

  resetToDefaults() {
    this.config = getDefaultConfig();
    this.save();
  }

  getWindowSize() {
    const w = Number(this.config?.window?.width) || 950;
    const h = Number(this.config?.window?.height) || 600;
    return {
      width: Math.max(w, MIN_FALLBACK_WIDTH),
      height: Math.max(h, MIN_FALLBACK_HEIGHT),
      maximised: !!this.config?.window?.maximised,
    };
  }

  updateWindowSize(width, height) {
    if (!this.configPath || width <= 0 || height <= 0) {
      return;
    }
    if (this.config.window.width === width && this.config.window.height === height) {
      return;
    }
    this.config.window.width = width;
    this.config.window.height = height;
    this.save();
  }

  updateWindowMaximised(maximised) {
    if (!this.configPath) {
      return;
    }
    if (this.config.window.maximised === maximised) {
      return;
    }
    this.config.window.maximised = maximised;
    this.save();
  }

  // 旧配置文件的 app 段可能没有 closeAction（load() 是浅合并），这里做兜底
  getCloseAction() {
    return this.config?.app?.closeAction === 'quit' ? 'quit' : 'tray';
  }

  setCloseAction(action) {
    const value = action === 'quit' ? 'quit' : 'tray';
    if (!this.config.app) {
      this.config.app = {};
    }
    if (this.config.app.closeAction !== value) {
      this.config.app.closeAction = value;
      this.save();
    }
    return value;
  }
}

const MIN_FALLBACK_WIDTH = 800;
const MIN_FALLBACK_HEIGHT = 600;

module.exports = new ConfigManager();
