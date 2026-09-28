'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Menu, Tray, nativeImage, shell, ipcMain } = require('electron');

const configManager = require('./config');
const { createTokenService } = require('./services/oauth');
const { createCenterService } = require('./services/center-service');
const { createFrpcService } = require('./services/frpc-service');
const { registerIpc } = require('./ipc');

const MIN_WINDOW_WIDTH = 800;
const MIN_WINDOW_HEIGHT = 600;

let mainWindow = null;
let tray = null;
let trayBalloonShown = false;
// 由 before-quit 置位：区分「用户关闭窗口」与「真正退出」
let isQuitting = false;

const APP_ICON_PATH = path.join(__dirname, '..', '..', 'build', 'appicon.png');

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

// 仅在「最小化到托盘」模式下创建托盘图标，切回「直接退出」时移除
function syncTray() {
  if (configManager.getCloseAction() !== 'tray') {
    destroyTray();
    return;
  }
  if (tray) {
    return;
  }

  const icon = nativeImage.createFromPath(APP_ICON_PATH);
  tray = new Tray(icon.isEmpty() ? APP_ICON_PATH : icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('LoliaNeko');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: showMainWindow },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', showMainWindow);
}

function notifyHiddenToTray() {
  if (trayBalloonShown || !tray) {
    return;
  }
  trayBalloonShown = true;
  if (process.platform === 'win32') {
    tray.displayBalloon({
      title: 'LoliaNeko 仍在后台运行',
      content: '点击托盘图标可重新打开窗口。',
    });
  }
}

function createWindow() {
  const { width, height, maximised } = configManager.getWindowSize();

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    frame: false,
    title: 'LoliaNeko',
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 隐藏到托盘时让 Chromium 节流该页面的定时器与渲染
      backgroundThrottling: true,
    },
  });

  if (maximised) {
    mainWindow.maximize();
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // 持久化窗口尺寸与最大化状态，并向前端推送状态变化（对应原 systemService 轮询）
  mainWindow.on('resize', () => {
    if (!mainWindow || mainWindow.isMaximized()) {
      return;
    }
    const [w, h] = mainWindow.getSize();
    configManager.updateWindowSize(w, h);
  });

  const emitWindowChanged = () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send('window:changed', {
      maximised: mainWindow.isMaximized(),
    });
  };
  mainWindow.on('maximize', () => {
    configManager.updateWindowMaximised(true);
    emitWindowChanged();
  });
  mainWindow.on('unmaximize', () => {
    configManager.updateWindowMaximised(false);
    emitWindowChanged();
  });

  // 关闭前强制停止 runner（对应原 OnBeforeClose）；
  // 托盘模式下改为隐藏窗口，runner 继续在后台运行
  let runnerStopped = false;
  mainWindow.on('close', async (event) => {
    if (!isQuitting && configManager.getCloseAction() === 'tray') {
      event.preventDefault();
      mainWindow.hide();
      notifyHiddenToTray();
      return;
    }
    if (runnerStopped) {
      return;
    }
    event.preventDefault();
    runnerStopped = true;
    try {
      await centerService.stopRunner();
    } catch {
      // 忽略停止失败，继续退出
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.destroy();
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
}

// 初始化服务（依赖 configManager 与 mainWindow 引用）
const tokenService = createTokenService();
const centerService = createCenterService(tokenService);
const frpcService = createFrpcService();

function getMainWindow() {
  return mainWindow;
}

// 开源许可文件（electron-builder 产物，位于应用根目录）
const LICENSE_FILE_NAME = 'LICENSES.chromium.html';
let licenseWindow = null;

function openLicenseWindow() {
  if (licenseWindow && !licenseWindow.isDestroyed()) {
    licenseWindow.focus();
    return true;
  }

  const licensePath = path.join(__dirname, '..', '..', LICENSE_FILE_NAME);
  if (!fs.existsSync(licensePath)) {
    throw new Error(`未找到开源许可文件: ${LICENSE_FILE_NAME}`);
  }

  licenseWindow = new BrowserWindow({
    width: 900,
    height: 700,
    title: '开源许可',
    parent: mainWindow || undefined,
    autoHideMenuBar: true,
    show: false,
    icon: APP_ICON_PATH,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  licenseWindow.once('ready-to-show', () => {
    if (licenseWindow && !licenseWindow.isDestroyed()) {
      licenseWindow.show();
    }
  });
  // 许可文件自带 <title>Credits</title>，阻止其覆盖窗口标题
  licenseWindow.on('page-title-updated', (event) => {
    event.preventDefault();
  });
  licenseWindow.on('closed', () => {
    licenseWindow = null;
  });

  licenseWindow.loadFile(licensePath);
  return true;
}

registerIpc({ ipcMain, app, configManager, tokenService, centerService, frpcService, getMainWindow });

// 窗口控制（返回值需与 ipc.js 的 wrap() 协议一致：{ ok, data }）
ipcMain.on('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});
ipcMain.handle('window:toggleMaximize', () => {
  if (!mainWindow) return { ok: true, data: false };
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
  return { ok: true, data: mainWindow.isMaximized() };
});
ipcMain.handle('window:isMaximized', () => {
  return { ok: true, data: mainWindow ? mainWindow.isMaximized() : false };
});
ipcMain.on('window:close', () => {
  if (mainWindow) mainWindow.close();
});
ipcMain.handle('app:getCloseAction', () => {
  return { ok: true, data: configManager.getCloseAction() };
});
ipcMain.handle('app:setCloseAction', (_event, action) => {
  try {
    const value = configManager.setCloseAction(action);
    syncTray();
    return { ok: true, data: value };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

ipcMain.handle('shell:openLicense', () => {
  try {
    return { ok: true, data: openLicenseWindow() };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

// 单实例
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // 窗口可能被隐藏到托盘，此时 focus() 唤不出来，必须显式 show
    if (app.isReady()) {
      showMainWindow();
    }
  });

  app.whenReady().then(() => {
    configManager.initialize();
    createWindow();
    syncTray();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  // 托盘模式下窗口只是隐藏，不应因此退出
  if (!isQuitting && configManager.getCloseAction() === 'tray') {
    return;
  }
  app.quit();
});

// 确保退出前 runner 被清理
app.on('before-quit', () => {
  isQuitting = true;
  centerService.stopRunner().catch(() => {});
});
