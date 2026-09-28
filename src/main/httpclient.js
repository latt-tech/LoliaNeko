'use strict';

const { getInfo, userAgent } = require('./version');

const info = getInfo();
const DEFAULT_USER_AGENT = userAgent();

class APIError extends Error {
  constructor({ path, statusCode, code, message }) {
    super(`api ${path} failed: status=${statusCode} code=${code} msg=${message}`);
    this.name = 'APIError';
    this.path = path;
    this.statusCode = statusCode;
    this.code = code;
    this.message = message;
    this.friendlyMessage = message;
  }
}

const ERR_UNAUTHORIZED = 'center api unauthorized';

function hasEnvelopeShape(root) {
  return (
    typeof root === 'object' &&
    root !== null &&
    ('code' in root || 'status' in root || 'msg' in root || 'data' in root)
  );
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) {
      return trimmed;
    }
  }
  return '';
}

function createClient({ baseURL, getAccessToken, onUnauthorized }) {
  const trimmedBase = String(baseURL || '').trim().replace(/\/+$/, '');

  async function doJSON(method, rawPath, query, body, { timeoutMs = 20000 } = {}) {
    const url = new URL(trimmedBase + rawPath);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (String(value ?? '').trim() !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers = {
      'User-Agent': process.env.LOLIA_HTTP_USER_AGENT || DEFAULT_USER_AGENT,
      Accept: 'application/json',
    };
    if (body !== undefined && body !== null) {
      headers['Content-Type'] = 'application/json';
    }
    if (typeof getAccessToken === 'function') {
      const accessToken = await getAccessToken();
      headers.Authorization = `Bearer ${accessToken}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let resp;
    try {
      resp = await fetch(url.toString(), {
        method,
        headers,
        body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(`请求 ${method} ${rawPath} 失败: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }

    const text = await resp.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }

    let businessCode = 0;
    let message = '';
    let data = undefined;
    const isEnvelope = parsed !== null && hasEnvelopeShape(parsed);
    if (isEnvelope) {
      businessCode = Number(parsed.code) || Number(parsed.status) || 0;
      message = String(parsed.msg ?? '').trim();
      data = parsed.data;
    } else if (parsed !== null && typeof parsed === 'object') {
      message = firstNonEmpty(parsed.msg, parsed.message, parsed.error);
      data = parsed;
    }
    if (!message && text) {
      message = text.trim();
    }

    if (
      resp.status === 401 ||
      resp.status === 403 ||
      businessCode === 401 ||
      businessCode === 403
    ) {
      if (typeof onUnauthorized === 'function') {
        try {
          await onUnauthorized();
        } catch {
          // 忽略清理失败
        }
      }
      const error = new APIError({
        path: rawPath,
        statusCode: resp.status,
        code: businessCode,
        message: message || '未授权，请重新登录',
      });
      error.unauthorized = true;
      error.code2 = ERR_UNAUTHORIZED;
      throw error;
    }

    if (resp.status < 200 || resp.status >= 300) {
      throw new APIError({
        path: rawPath,
        statusCode: resp.status,
        code: businessCode,
        message: message || '请求失败',
      });
    }

    if (businessCode !== 0 && businessCode !== 200) {
      throw new APIError({
        path: rawPath,
        statusCode: resp.status,
        code: businessCode,
        message: message || '请求失败',
      });
    }

    return data;
  }

  return { doJSON };
}

module.exports = { createClient, APIError };
