'use strict';

const { shell } = require('electron');
const versionInfo = require('./version');

function wrap(fn) {
  return async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  };
}

function registerIpc({ ipcMain, app, configManager, tokenService, centerService, frpcService, getMainWindow }) {
  // ---- App / 配置 ----
  ipcMain.handle('app:getConfigJSON', wrap(() => configManager.getConfigJSON()));
  ipcMain.handle('app:updateConfig', wrap((jsonStr) => configManager.updateConfig(jsonStr)));
  ipcMain.handle('app:getConfigPath', wrap(() => configManager.getConfigPath()));
  ipcMain.handle('app:resetConfig', wrap(() => configManager.resetToDefaults()));
  ipcMain.handle('app:getVersionInfo', wrap(() => versionInfo.getInfo()));
  ipcMain.handle('app:getAutoLaunch', wrap(() => app.getLoginItemSettings().openAtLogin));
  ipcMain.handle('app:setAutoLaunch', wrap((enabled) => {
    app.setLoginItemSettings({ openAtLogin: !!enabled });
    return app.getLoginItemSettings().openAtLogin;
  }));

  // ---- Token / OAuth ----
  ipcMain.handle('token:hasOAuthToken', wrap(() => tokenService.hasOAuthToken()));
  ipcMain.handle('token:beginOAuthLogin', wrap(() => tokenService.beginOAuthLogin()));
  ipcMain.handle('token:clearOAuthToken', wrap(() => tokenService.clearOAuthToken()));

  // ---- Center ----
  ipcMain.handle('center:getDashboard', wrap(() => centerService.getDashboard()));
  ipcMain.handle('center:getTunnelsOverview', wrap((page, limit, days) => centerService.getTunnelsOverview(page, limit, days)));
  ipcMain.handle('center:getRunnerData', wrap((tunnelID) => centerService.getRunnerData(tunnelID)));
  ipcMain.handle('center:getTunnelDetail', wrap((name) => centerService.getTunnelDetail(name)));
  ipcMain.handle('center:startRunner', wrap((names) => centerService.startRunner(names)));
  ipcMain.handle('center:stopRunner', wrap(() => centerService.stopRunner()));
  ipcMain.handle('center:getRunnerRuntimeStatus', wrap(() => centerService.getRunnerRuntimeStatus()));
  ipcMain.handle('center:getTrafficDaily', wrap((days) => centerService.getTrafficDaily(days)));

  // ---- Frpc ----
  ipcMain.handle('frpc:getFrpcStatus', wrap(() => frpcService.getFrpcStatus()));
  ipcMain.handle('frpc:installOrUpdateFrpc', wrap(async () => {
    const win = getMainWindow();
    const sendProgress = (phase, downloaded, total) => {
      if (!win || win.isDestroyed()) {
        return;
      }
      let percent = 0;
      if (total > 0) {
        percent = Math.min((downloaded / total) * 100, 100);
      }
      win.webContents.send('frpc_install_progress', { phase, downloaded, total, percent });
    };
    return frpcService.installOrUpdateFrpc(sendProgress);
  }));
  ipcMain.handle('frpc:cancelInstallOrUpdateFrpc', wrap(async () => frpcService.cancelInstallOrUpdateFrpc()));
  ipcMain.handle('frpc:removeFrpc', wrap(async () => frpcService.removeFrpc()));
  ipcMain.handle('frpc:getGitHubMirrorURL', wrap(() => frpcService.getGitHubMirrorURL()));
  ipcMain.handle('frpc:setGitHubMirrorURL', wrap((url) => frpcService.setGitHubMirrorURL(url)));
  ipcMain.handle('frpc:getMirrorConfig', wrap(() => frpcService.getMirrorConfig()));
  ipcMain.handle('frpc:setMirrorConfig', wrap((config) => frpcService.setMirrorConfig(config)));

  // ---- 通用 ----
  ipcMain.handle('shell:openExternal', wrap((url) => {
    const value = String(url || '').trim();
    if (!value.startsWith('http://') && !value.startsWith('https://')) {
      throw new Error('仅允许打开 http/https 链接');
    }
    return shell.openExternal(value);
  }));
  ipcMain.handle('app:quit', wrap(() => app.quit()));
}

module.exports = { registerIpc };
