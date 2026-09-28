'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const { createCenterAPI } = require('../api-center');

const RUNNER_LOG_MAX_LINES = 300;
const RUNNER_STOP_TIMEOUT_MS = 3000;
const RUNNER_TOKEN_ARG_PATTERN = /^[0-9]+:[A-Za-z0-9._~+/=-]+$/;

function frpcBinaryName() {
  return process.platform === 'win32' ? 'frpc.exe' : 'frpc';
}

function normalizeTunnelNames(names) {
  if (!Array.isArray(names) || names.length === 0) {
    return [];
  }
  const seen = new Set();
  const result = [];
  for (const name of names) {
    const trimmed = String(name || '').trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function mergeTunnelNames(current, requested) {
  const seen = new Set();
  const merged = [];
  const append = (names) => {
    for (const name of names || []) {
      const trimmed = String(name || '').trim();
      if (!trimmed || seen.has(trimmed)) {
        continue;
      }
      seen.add(trimmed);
      merged.push(trimmed);
    }
  };
  append(current);
  append(requested);
  return merged;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const trimmed = String(value || '').trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return '';
}

function maskRunnerTokenArg(tokenArg) {
  const idx = tokenArg.indexOf(':');
  if (idx < 0) {
    return tokenArg;
  }
  const prefix = tokenArg.slice(0, idx);
  const token = tokenArg.slice(idx + 1).trim();
  if (!token || token.length <= 8) {
    return `${prefix}:***`;
  }
  return `${prefix}:${token.slice(0, 4)}***${token.slice(-4)}`;
}

function buildMaskedRunnerCommand(binaryPath, tokenArgs) {
  if (!tokenArgs.length) {
    return binaryPath;
  }
  const parts = [binaryPath];
  for (const tokenArg of tokenArgs) {
    parts.push('-t', maskRunnerTokenArg(tokenArg));
  }
  return parts.join(' ');
}

function enrichTunnelNodeMeta(tunnels, nodeMetaByID) {
  if (!tunnels || tunnels.length === 0) {
    return [];
  }
  return tunnels.map((tunnel) => {
    const current = { ...tunnel };
    const node = nodeMetaByID.get(Number(tunnel.node_id));
    if (node) {
      if (!String(current.node_address || '').trim()) {
        current.node_address = String(node.ip_address || '').trim();
      }
      if (!String(current.node_name || '').trim()) {
        current.node_name = String(node.name || '').trim();
      }
    }
    return current;
  });
}

function createCenterService(tokenService) {
  const api = createCenterAPI({
    getAccessToken: () => tokenService.getValidAccessToken(),
    onUnauthorized: async () => {
      tokenService.clearOAuthTokenSync();
    },
  });

  const state = {
    proc: null,
    startedAt: null,
    tunnelName: '',
    tunnelNames: [],
    nodeAddress: '',
    command: '',
    lastError: '',
    logs: [],
    stopping: false,
  };

  function appendLog(line) {
    const trimmed = String(line || '').trim();
    if (!trimmed) {
      return;
    }
    state.logs.push(trimmed);
    if (state.logs.length > RUNNER_LOG_MAX_LINES) {
      state.logs = state.logs.slice(state.logs.length - RUNNER_LOG_MAX_LINES);
    }
  }

  function isRunning() {
    return !!state.proc && !state.proc.killed && state.proc.exitCode === null && state.proc.signalCode === null;
  }

  function buildStatus() {
    return {
      running: isRunning(),
      pid: state.proc ? state.proc.pid || 0 : 0,
      started_at: state.startedAt ? state.startedAt.toISOString() : undefined,
      tunnel_name: state.tunnelName || undefined,
      tunnel_names: state.tunnelNames.length ? [...state.tunnelNames] : undefined,
      node_address: state.nodeAddress || undefined,
      command: state.command || undefined,
      last_error: state.lastError || undefined,
      log_lines: state.logs.length ? [...state.logs] : undefined,
    };
  }

  function resolveTrustedRunnerBinaryPath() {
    const { app } = require('electron');
    const installDir = path.join(app.getPath('userData'), 'userdata', 'frpc', 'bin');
    const binaryName = frpcBinaryName();
    const target = path.resolve(installDir, binaryName);
    if (path.dirname(target) !== path.resolve(installDir)) {
      throw new Error(`非法的 frpc 安装目录: ${target}`);
    }
    if (path.basename(target) !== binaryName) {
      throw new Error(`非法的 frpc 文件名: ${target}`);
    }
    let stat;
    try {
      stat = fs.lstatSync(target);
    } catch (err) {
      if (err.code === 'ENOENT') {
        throw new Error(`frpc 未安装，请先在设置页面安装: ${target}`);
      }
      throw new Error(`检查文件失败 ${target}: ${err.message}`);
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`runner 可执行文件不能是符号链接: ${target}`);
    }
    if (stat.isDirectory()) {
      throw new Error(`frpc 未安装，请先在设置页面安装: ${target}`);
    }
    return target;
  }

  async function getDashboard() {
    const user = await api.getUserInfo();
    const traffic = await api.getUserTrafficStats();
    const tunnelList = await api.getUserTunnels(1, 20);
    const nodeMetaByID = new Map();
    try {
      const nodes = await api.getNodes();
      for (const node of nodes?.nodes || []) {
        nodeMetaByID.set(Number(node.id), node);
      }
    } catch {
      // 节点信息失败不阻断
    }
    const version = await api.getClientVersion();
    const homeStats = await api.getHomeStats();

    return {
      user,
      traffic,
      tunnel: {
        count: (tunnelList?.list || []).length,
        total: tunnelList?.total || 0,
      },
      tunnels: enrichTunnelNodeMeta(tunnelList?.list || [], nodeMetaByID),
      app: version,
      home: homeStats,
    };
  }

  async function getTunnelsOverview(page, limit, days) {
    const tunnelList = await api.getUserTunnels(page, limit);

    const trafficByName = new Map();
    if (days > 0) {
      try {
        const traffic = await api.getTrafficTunnels(days);
        for (const item of traffic?.tunnels || []) {
          trafficByName.set(String(item.tunnel_name || '').trim(), item);
        }
      } catch {
        // 流量数据失败不阻断
      }
    }
    const nodeMetaByID = new Map();
    try {
      const nodes = await api.getNodes();
      for (const node of nodes?.nodes || []) {
        nodeMetaByID.set(Number(node.id), node);
      }
    } catch {
      // 节点信息失败不阻断
    }

    const enriched = (tunnelList?.list || []).map((tunnel) => {
      const current = { ...tunnel };
      const node = nodeMetaByID.get(Number(tunnel.node_id));
      if (node) {
        if (!String(current.node_address || '').trim()) {
          current.node_address = String(node.ip_address || '').trim();
        }
        if (!String(current.node_name || '').trim()) {
          current.node_name = String(node.name || '').trim();
        }
      }
      const traffic = trafficByName.get(String(tunnel.name || '').trim());
      if (traffic) {
        current.total_in = traffic.total_in;
        current.total_out = traffic.total_out;
        current.total_traffic = traffic.total_traffic;
      }
      return current;
    });

    return {
      list: enriched,
      page: tunnelList?.page || page,
      limit: tunnelList?.limit || limit,
      total: tunnelList?.total || 0,
      total_page: tunnelList?.total_page || 0,
    };
  }

  async function getRunnerData(tunnelID) {
    const version = await api.getClientVersion();
    const nodes = await api.getNodes();
    const tunnels = await api.getUserTunnels(1, 100);

    let selectedTunnel = null;
    if (tunnelID > 0) {
      selectedTunnel = (tunnels?.list || []).find((item) => Number(item.id) === Number(tunnelID)) || null;
    }
    if (!selectedTunnel && (tunnels?.list || []).length > 0) {
      selectedTunnel = tunnels.list[0];
    }
    if (selectedTunnel) {
      selectedTunnel = { ...selectedTunnel };
      const node = (nodes?.nodes || []).find((n) => Number(n.id) === Number(selectedTunnel.node_id));
      if (node) {
        if (!String(selectedTunnel.node_address || '').trim()) {
          selectedTunnel.node_address = String(node.ip_address || '').trim();
        }
        if (!String(selectedTunnel.node_name || '').trim()) {
          selectedTunnel.node_name = String(node.name || '').trim();
        }
      }
    }

    return {
      config: '',
      version: version?.version || '',
      nodes: nodes?.nodes || [],
      current_tunnel: selectedTunnel,
    };
  }

  async function startRunner(tunnelNames) {
    let selected = normalizeTunnelNames(tunnelNames);
    const currentlyRunning = isRunning();
    const existingTunnelNames = [...state.tunnelNames];
    if (currentlyRunning) {
      const merged = mergeTunnelNames(existingTunnelNames, selected);
      if (merged.length === existingTunnelNames.length) {
        return buildStatus();
      }
      await stopRunner();
      selected = merged;
    }

    if (selected.length === 0) {
      const tunnels = await api.getUserTunnels(1, 100);
      if ((tunnels?.list || []).length === 0) {
        throw new Error('当前账号暂无隧道，无法启动 frpc');
      }
      selected = [String(tunnels.list[0].name || '').trim()];
    }
    if (selected.length === 0) {
      throw new Error('无效的隧道名称');
    }

    const tokenArgs = [];
    const resolvedTunnelNames = [];
    const nodeAddresses = [];
    for (const tunnelName of selected) {
      const detail = await api.getTunnelDetail(tunnelName);
      if (!detail) {
        throw new Error(`获取隧道详情失败：${tunnelName}`);
      }
      if (Number(detail.id) <= 0) {
        throw new Error(`隧道详情缺少有效 id：${tunnelName}`);
      }
      const token = String(detail.tunnel_token || '').trim();
      if (!token) {
        throw new Error(`隧道详情未返回 tunnel_token：${tunnelName}`);
      }
      tokenArgs.push(`${detail.id}:${token}`);
      resolvedTunnelNames.push(String(detail.name || '').trim());
      nodeAddresses.push(String(detail.node_address || '').trim());
    }

    const binaryPath = resolveTrustedRunnerBinaryPath();

    if (isRunning()) {
      return buildStatus();
    }

    const args = [];
    for (const tokenArg of tokenArgs) {
      if (!RUNNER_TOKEN_ARG_PATTERN.test(tokenArg)) {
        throw new Error('非法的 tunnel token 参数');
      }
      args.push('-t', tokenArg);
    }

    const proc = spawn(binaryPath, args, {
      cwd: path.dirname(binaryPath),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    state.proc = proc;
    state.startedAt = new Date();
    state.tunnelName = firstNonEmpty(...resolvedTunnelNames);
    state.tunnelNames = [...resolvedTunnelNames];
    state.nodeAddress = firstNonEmpty(...nodeAddresses);
    state.command = buildMaskedRunnerCommand(binaryPath, tokenArgs);
    state.lastError = '';
    state.logs = [`[runner] started: pid=${proc.pid}`];
    state.stopping = false;

    const handleOutput = (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        appendLog(line);
      }
    };
    proc.stdout.on('data', handleOutput);
    proc.stderr.on('data', handleOutput);

    proc.on('error', (err) => {
      state.lastError = err.message;
      appendLog(`[runner] error: ${err.message}`);
      state.proc = null;
    });

    proc.on('exit', (code, signal) => {
      const wasStopping = state.stopping;
      state.stopping = false;
      if (code !== 0 && code !== null && !wasStopping && signal !== 'SIGINT' && signal !== 'SIGTERM') {
        state.lastError = `exit code=${code} signal=${signal || 'none'}`;
        appendLog(`[runner] exited with error: code=${code} signal=${signal || 'none'}`);
      } else {
        appendLog('[runner] exited');
      }
      if (state.proc === proc) {
        state.proc = null;
      }
    });

    return buildStatus();
  }

  async function stopRunner() {
    if (!isRunning()) {
      return buildStatus();
    }

    const proc = state.proc;
    state.stopping = true;

    // 先尝试优雅终止（Windows 上 signal 无效，直接走强杀路径）
    try {
      proc.kill('SIGINT');
    } catch {
      // 忽略
    }

    const deadline = Date.now() + RUNNER_STOP_TIMEOUT_MS;
    while (Date.now() < deadline && isRunning()) {
      await new Promise((r) => setTimeout(r, 100));
    }

    if (isRunning()) {
      try {
        proc.kill('SIGTERM');
      } catch {
        // 忽略
      }
      const deadline2 = Date.now() + RUNNER_STOP_TIMEOUT_MS;
      while (Date.now() < deadline2 && isRunning()) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (isRunning()) {
      try {
        proc.kill();
      } catch {
        // 忽略
      }
    }

    return buildStatus();
  }

  async function getRunnerRuntimeStatus() {
    return buildStatus();
  }

  return {
    getDashboard,
    getTunnelsOverview,
    getRunnerData,
    startRunner,
    stopRunner,
    getRunnerRuntimeStatus,
    getUserInfo: () => api.getUserInfo(),
    getUserTrafficStats: () => api.getUserTrafficStats(),
    getUserTunnels: (page, limit) => api.getUserTunnels(page, limit),
    getTrafficTunnels: (days) => api.getTrafficTunnels(days),
    getTrafficDaily: (days) => api.getTrafficDaily(days > 0 ? days : 7),
    getNodes: () => api.getNodes(),
    getFrpcConfig: (tunnel) => api.getFrpcConfig(tunnel),
    getTunnelDetail: (tunnelName) => api.getTunnelDetail(tunnelName),
    getClientVersion: () => api.getClientVersion(),
    getHomeStats: () => api.getHomeStats(),
  };
}

module.exports = { createCenterService };
