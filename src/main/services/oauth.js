'use strict';

const crypto = require('crypto');
const http = require('http');
const { shell } = require('electron');

const tokenStore = require('./token-store');

const defaultOAuthAuthorizeURL = 'https://dash.lolia.link/oauth/authorize';
const defaultOAuthTokenURL = 'https://api.lolia.link/api/v1/oauth2/token';
const defaultOAuthRedirectURL = 'http://127.0.0.1:11419';
const defaultOAuthScope = 'all';
const defaultOAuthClientID = 'e6f87hoftrh3gh7s';

const OAUTH_AUTH_TIMEOUT_MS = 3 * 60 * 1000;
const OAUTH_TOKEN_TIMEOUT_MS = 20 * 1000;

function resolveOAuthConfig() {
  const env = process.env;
  return {
    clientID: (env.LOLIA_OAUTH_CLIENT_ID || '').trim() || defaultOAuthClientID,
    authorizeURL: (env.LOLIA_OAUTH_AUTHORIZE_URL || '').trim() || defaultOAuthAuthorizeURL,
    tokenURL: (env.LOLIA_OAUTH_TOKEN_URL || '').trim() || defaultOAuthTokenURL,
    redirectURL: (env.LOLIA_OAUTH_REDIRECT_URL || '').trim() || defaultOAuthRedirectURL,
    scope: defaultOAuthScope,
  };
}

function randomURLSafeString(size) {
  return crypto.randomBytes(size).toString('base64url');
}

function requestTokenEndpoint(params) {
  const { tokenURL, clientID } = resolveOAuthConfig();
  const body = new URLSearchParams({ client_id: clientID, ...params });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OAUTH_TOKEN_TIMEOUT_MS);

  return fetch(tokenURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
    signal: controller.signal,
  })
    .then(async (resp) => {
      const text = await resp.text();
      let payload = null;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
      if (!resp.ok) {
        const msg = payload ? payload.error_description || payload.error || text : text;
        throw new Error(`oauth token 请求失败: ${msg}`);
      }
      if (!payload || !payload.access_token) {
        throw new Error('oauth token 响应缺少 access_token');
      }
      return payload;
    })
    .finally(() => clearTimeout(timer));
}

function normalizeToken(payload) {
  const token = {
    access_token: String(payload.access_token || ''),
    token_type: String(payload.token_type || 'Bearer'),
    refresh_token: String(payload.refresh_token || ''),
    expiry: '',
  };
  if (Number(payload.expires_in) > 0) {
    token.expiry = new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString();
  }
  return token;
}

function isTokenValid(token) {
  if (!token || !String(token.access_token || '').trim()) {
    return false;
  }
  if (!token.expiry) {
    return true;
  }
  const expiry = Date.parse(token.expiry);
  if (Number.isNaN(expiry)) {
    return true;
  }
  // 提前 60 秒视为过期
  return expiry - 60_000 > Date.now();
}

async function loadOrRefreshOAuthToken() {
  let token;
  try {
    token = tokenStore.loadOAuthToken();
  } catch (err) {
    if (err.notFound) {
      throw new Error('未登录，请先完成 OAuth 授权');
    }
    throw err;
  }

  if (isTokenValid(token)) {
    return token;
  }

  if (!String(token.refresh_token || '').trim()) {
    throw new Error('访问令牌已过期且无刷新令牌，请重新登录');
  }

  const payload = await requestTokenEndpoint({
    grant_type: 'refresh_token',
    refresh_token: token.refresh_token,
  });
  const refreshed = normalizeToken(payload);
  if (!refreshed.refresh_token) {
    refreshed.refresh_token = token.refresh_token;
  }
  tokenStore.saveOAuthToken(refreshed);
  return refreshed;
}

async function beginOAuthLogin() {
  const oauthCfg = resolveOAuthConfig();
  const redirect = new URL(oauthCfg.redirectURL);
  if (redirect.protocol !== 'http:') {
    throw new Error('redirect_uri must use http for desktop loopback callback');
  }

  const state = randomURLSafeString(32);
  const codeVerifier = randomURLSafeString(64);
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  const port = Number(redirect.port) || 80;
  const handlerPath = redirect.pathname && redirect.pathname !== '/' ? redirect.pathname : '/';

  const resultPromise = new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url, `http://localhost:${port}`);
      if (reqUrl.pathname !== handlerPath) {
        res.writeHead(404);
        res.end('not found');
        return;
      }

      const cleanup = () => {
        setTimeout(() => server.close(), 100);
      };

      if (reqUrl.searchParams.get('state') !== state) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('OAuth state mismatch');
        cleanup();
        reject(new Error('oauth state mismatch'));
        return;
      }

      const oauthErr = (reqUrl.searchParams.get('error') || '').trim();
      if (oauthErr) {
        const desc = (reqUrl.searchParams.get('error_description') || '').trim();
        const message = desc ? `${oauthErr}: ${desc}` : oauthErr;
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(message);
        cleanup();
        reject(new Error(`oauth authorize failed: ${message}`));
        return;
      }

      const code = (reqUrl.searchParams.get('code') || '').trim();
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('missing OAuth code');
        cleanup();
        reject(new Error('missing oauth code'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body><h3>Login Success</h3><p>You can return to the app now.</p></body></html>');
      cleanup();
      resolve(code);
    });

    server.on('error', (err) => {
      reject(new Error(`listen oauth callback ${redirect.host}: ${err.message}`));
    });

    server.listen(port, '0.0.0.0');
  });

  const authUrl = new URL(oauthCfg.authorizeURL);
  authUrl.searchParams.set('client_id', oauthCfg.clientID);
  authUrl.searchParams.set('redirect_uri', oauthCfg.redirectURL);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', oauthCfg.scope);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  await shell.openExternal(authUrl.toString());

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('oauth authorization timed out')), OAUTH_AUTH_TIMEOUT_MS),
  );

  const code = await Promise.race([resultPromise, timeoutPromise]);

  const payload = await requestTokenEndpoint({
    grant_type: 'authorization_code',
    code,
    redirect_uri: oauthCfg.redirectURL,
    code_verifier: codeVerifier,
  });

  tokenStore.saveOAuthToken(normalizeToken(payload));
  return true;
}

function createTokenService() {
  return {
    async hasOAuthToken() {
      try {
        const token = await loadOrRefreshOAuthToken();
        return !!token;
      } catch (err) {
        if (err.notFound) {
          return false;
        }
        throw err;
      }
    },
    async beginOAuthLogin() {
      return beginOAuthLogin();
    },
    async clearOAuthToken() {
      tokenStore.clearOAuthToken();
    },
    async getValidAccessToken() {
      const token = await loadOrRefreshOAuthToken();
      return token.access_token;
    },
    clearOAuthTokenSync() {
      tokenStore.clearOAuthToken();
    },
  };
}

module.exports = { createTokenService, loadOrRefreshOAuthToken };
