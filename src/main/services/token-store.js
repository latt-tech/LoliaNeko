'use strict';

const path = require('path');
const fs = require('fs');
const { app, safeStorage } = require('electron');

// 使用 Electron safeStorage（Windows 上为 DPAPI 加密）替代 Go 侧的 OS keyring，
// 密文落盘于 userData/token.json。
const TOKEN_FILE = 'token.json';

function tokenFilePath() {
  return path.join(app.getPath('userData'), TOKEN_FILE);
}

function encryptString(plain) {
  if (safeStorage.isEncryptionAvailable()) {
    return { encrypted: true, data: safeStorage.encryptString(plain).toString('base64') };
  }
  return { encrypted: false, data: Buffer.from(plain, 'utf8').toString('base64') };
}

function decryptString(payload) {
  if (payload.encrypted) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('无法解密本地凭据，请重新登录');
    }
    return safeStorage.decryptString(Buffer.from(payload.data, 'base64'));
  }
  return Buffer.from(payload.data, 'base64').toString('utf8');
}

function saveOAuthToken(token) {
  if (!token || !String(token.access_token || '').trim()) {
    throw new Error('oauth token is empty');
  }
  const payload = encryptString(JSON.stringify(token));
  fs.mkdirSync(path.dirname(tokenFilePath()), { recursive: true });
  fs.writeFileSync(tokenFilePath(), JSON.stringify(payload), 'utf8');
}

function loadOAuthToken() {
  const file = tokenFilePath();
  if (!fs.existsSync(file)) {
    const error = new Error('token not found');
    error.notFound = true;
    throw error;
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const json = decryptString(raw);
  const token = JSON.parse(json);
  if (!String(token.access_token || '').trim()) {
    throw new Error('oauth token access_token is empty');
  }
  return token;
}

function clearOAuthToken() {
  try {
    fs.unlinkSync(tokenFilePath());
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
}

function hasOAuthToken() {
  try {
    const token = loadOAuthToken();
    return !!token && String(token.access_token || '').trim() !== '';
  } catch (err) {
    if (err.notFound) {
      return false;
    }
    throw err;
  }
}

module.exports = { saveOAuthToken, loadOAuthToken, clearOAuthToken, hasOAuthToken };
