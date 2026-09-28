'use strict';

const { createClient } = require('./httpclient');

const defaultCenterAPIBaseURL = 'https://api.lolia.link/api/v1';

function centerAPIBaseURL() {
  const baseURL = (process.env.LOLIA_CENTER_API_BASE_URL || '').trim();
  return (baseURL || defaultCenterAPIBaseURL).replace(/\/+$/, '');
}

function createCenterAPI({ getAccessToken, onUnauthorized }) {
  const client = createClient({
    baseURL: centerAPIBaseURL(),
    getAccessToken,
    onUnauthorized,
  });

  return {
    async getUserInfo() {
      return client.doJSON('GET', '/user/info');
    },
    async getUserTrafficStats() {
      return client.doJSON('GET', '/user/traffic/stats');
    },
    async getUserTunnels(page, limit) {
      return client.doJSON('GET', '/user/tunnel', { page, limit });
    },
    async getTrafficTunnels(days) {
      return client.doJSON('GET', '/user/traffic/tunnels', { days });
    },
    async getTrafficDaily(days) {
      return client.doJSON('GET', '/user/traffic/daily', { days });
    },
    async getNodes() {
      return client.doJSON('POST', '/user/nodes', null, {});
    },
    async getFrpcConfig(tunnel) {
      return client.doJSON('GET', '/user/frpc/config', { tunnel });
    },
    async getTunnelDetail(tunnelName) {
      const trimmed = String(tunnelName || '').trim();
      if (!trimmed) {
        return null;
      }
      return client.doJSON('GET', '/user/tunnel/' + encodeURIComponent(trimmed));
    },
    async getClientVersion() {
      return client.doJSON('GET', '/client/version');
    },
    async getHomeStats() {
      return client.doJSON('GET', '/home');
    },
  };
}

module.exports = { createCenterAPI, centerAPIBaseURL };
