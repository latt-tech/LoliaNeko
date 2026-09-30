'use strict';

const { contextBridge, ipcRenderer } = require('electron');

async function invoke(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (result && result.ok) {
    return result.data;
  }
  const error = new Error(result && result.error ? result.error : '请求失败');
  throw error;
}

contextBridge.exposeInMainWorld('neko', {
  app: {
    getConfigJSON: () => invoke('app:getConfigJSON'),
    updateConfig: (jsonStr) => invoke('app:updateConfig', jsonStr),
    getConfigPath: () => invoke('app:getConfigPath'),
    resetConfig: () => invoke('app:resetConfig'),
    getVersionInfo: () => invoke('app:getVersionInfo'),
    getAutoLaunch: () => invoke('app:getAutoLaunch'),
    setAutoLaunch: (enabled) => invoke('app:setAutoLaunch', enabled),
    getAutoStartBehavior: () => invoke('app:getAutoStartBehavior'),
    setAutoStartBehavior: (behavior) => invoke('app:setAutoStartBehavior', behavior),
    getAutoStartTunnels: () => invoke('app:getAutoStartTunnels'),
    setAutoStartTunnels: (names) => invoke('app:setAutoStartTunnels', names),
    getCloseAction: () => invoke('app:getCloseAction'),
    setCloseAction: (action) => invoke('app:setCloseAction', action),
    quit: () => invoke('app:quit'),
  },
  token: {
    hasOAuthToken: () => invoke('token:hasOAuthToken'),
    beginOAuthLogin: () => invoke('token:beginOAuthLogin'),
    clearOAuthToken: () => invoke('token:clearOAuthToken'),
  },
  center: {
    getDashboard: () => invoke('center:getDashboard'),
    getTunnelsOverview: (page, limit, days) => invoke('center:getTunnelsOverview', page, limit, days),
    getRunnerData: (tunnelID) => invoke('center:getRunnerData', tunnelID),
    getTunnelDetail: (name) => invoke('center:getTunnelDetail', name),
    startRunner: (names) => invoke('center:startRunner', names),
    stopRunner: () => invoke('center:stopRunner'),
    getRunnerRuntimeStatus: () => invoke('center:getRunnerRuntimeStatus'),
    getTrafficDaily: (days) => invoke('center:getTrafficDaily', days),
  },
  frpc: {
    getFrpcStatus: () => invoke('frpc:getFrpcStatus'),
    installOrUpdateFrpc: () => invoke('frpc:installOrUpdateFrpc'),
    cancelInstallOrUpdateFrpc: () => invoke('frpc:cancelInstallOrUpdateFrpc'),
    removeFrpc: () => invoke('frpc:removeFrpc'),
    getGitHubMirrorURL: () => invoke('frpc:getGitHubMirrorURL'),
    setGitHubMirrorURL: (url) => invoke('frpc:setGitHubMirrorURL', url),
    getMirrorConfig: () => invoke('frpc:getMirrorConfig'),
    setMirrorConfig: (config) => invoke('frpc:setMirrorConfig', config),
    onInstallProgress: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('frpc_install_progress', listener);
      return () => ipcRenderer.removeListener('frpc_install_progress', listener);
    },
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => invoke('window:toggleMaximize'),
    isMaximized: () => invoke('window:isMaximized'),
    close: () => ipcRenderer.send('window:close'),
    onChanged: (callback) => {
      const listener = (_event, info) => callback(info);
      ipcRenderer.on('window:changed', listener);
      return () => ipcRenderer.removeListener('window:changed', listener);
    },
  },
  shell: {
    openExternal: (url) => invoke('shell:openExternal', url),
    openLicense: () => invoke('shell:openLicense'),
  },
});
