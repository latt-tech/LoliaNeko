'use strict';

/* LoliaNeko 渲染层（MDUI V1 + 原生 JS） */

const api = window.neko;

/* ================= 工具 ================= */

function formatBytes(value) {
  const num = Number(value) || 0;
  if (!Number.isFinite(num) || num <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = num;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function showMessage(text, type) {
  mdui.snackbar({
    message: escapeHtml(text),
    timeout: 2600,
    position: 'bottom',
  });
}

let loadingCount = 0;
const loadingBar = document.getElementById('loading-bar');

async function withLoading(task) {
  loadingCount += 1;
  loadingBar.hidden = false;
  try {
    return await task();
  } finally {
    loadingCount = Math.max(0, loadingCount - 1);
    if (loadingCount === 0) {
      loadingBar.hidden = true;
    }
  }
}

/* ================= 主题 ================= */

const themeStorageKey = 'lolia.theme';
const accentStorageKey = 'lolia.accent';

const accentPresets = [
  { id: 'pink', name: '樱粉', light: '#F06292', dark: '#F491B2' },
  { id: 'blue', name: '天蓝', light: '#1E88E5', dark: '#64B5F6' },
  { id: 'purple', name: '雅紫', light: '#7E57C2', dark: '#B39DDB' },
  { id: 'teal', name: '青碧', light: '#00897B', dark: '#4DB6AC' },
  { id: 'orange', name: '暖橙', light: '#FB8C00', dark: '#FFB74D' },
  { id: 'green', name: '草绿', light: '#43A047', dark: '#81C784' },
  { id: 'red', name: '绯红', light: '#E53935', dark: '#EF5350' },
];

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function getSystemDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function currentThemeMode() {
  const saved = readStorage(themeStorageKey);
  return saved === 'light' || saved === 'dark' || saved === 'auto' ? saved : 'light';
}

function isDarkActive() {
  const mode = currentThemeMode();
  if (mode === 'auto') {
    return getSystemDark();
  }
  return mode === 'dark';
}

function currentAccentId() {
  const saved = readStorage(accentStorageKey);
  return accentPresets.some((p) => p.id === saved) ? saved : 'pink';
}

let accentStyleEl = null;

function applyAccent() {
  const preset = accentPresets.find((p) => p.id === currentAccentId()) || accentPresets[0];
  const color = isDarkActive() ? preset.dark : preset.light;
  // 窗口控制按钮跟随强调色，但用明暗色阶与同色的标题栏区分开
  const accentShade = isDarkActive()
    ? `color-mix(in srgb, ${color} 74%, #ffffff)`
    : `color-mix(in srgb, ${color} 80%, #000000)`;
  const styleText = `
    :root { --ls-accent: ${color}; }
    .mdui-appbar .mdui-toolbar { background: ${color} !important; }
    .mdui-color-theme { background-color: ${color} !important; color: #fff !important; }
    .mdui-btn.mdui-color-theme { background-color: ${color} !important; color: #fff !important; }
    /* MDUI 自带 .mdui-theme-accent-* .mdui-color-theme-accent 规则(0,2,0 + !important),用 ID 选择器压过它 */
    #win-min, #win-max, #win-close { background-color: ${accentShade} !important; color: #fff !important; }
    .mdui-fab.mdui-color-theme { background-color: ${color} !important; color: #fff !important; }
    .mdui-textfield-focus .mdui-textfield-input { border-bottom-color: ${color} !important; box-shadow: 0 1px 0 0 ${color} !important; }
    .mdui-textfield-focus .mdui-textfield-label { color: ${color} !important; }
    a { color: ${color}; }
    .mdui-list-item.mdui-active { color: ${color} !important; }
    .frpc-hero { background: linear-gradient(135deg, ${color}, ${color}cc) !important; }
    .about-hero { background: linear-gradient(135deg, ${color}, ${color}cc) !important; }
    .home-avatar, .stat-icon { background: ${color} !important; }
  `;
  if (!accentStyleEl) {
    accentStyleEl = document.createElement('style');
    document.head.appendChild(accentStyleEl);
  }
  accentStyleEl.textContent = styleText;
}

function applyTheme() {
  const dark = isDarkActive();
  document.documentElement.classList.toggle('mdui-theme-layout-dark', dark);
  // 让滚动条与原生控件跟随应用主题，而不是系统主题
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  applyAccent();
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (currentThemeMode() === 'auto') {
    applyTheme();
  }
});

/* ================= 路由 ================= */

const appNav = document.getElementById('app-nav');
const fabRunner = document.getElementById('fab-runner');
const pages = {
  home: document.getElementById('page-home'),
  oauth: document.getElementById('page-oauth'),
  tunnels: document.getElementById('page-tunnels'),
  runner: document.getElementById('page-runner'),
  settings: document.getElementById('page-settings'),
};

let activeRoute = '';
let authState = null;
let pageMounted = {};

function navigate(route) {
  window.location.hash = `#/${route}`;
}

async function ensureAuth() {
  try {
    authState = await api.token.hasOAuthToken();
  } catch {
    authState = false;
  }
  return authState;
}

async function handleRouteChange() {
  let route = (window.location.hash || '').replace(/^#\//, '') || 'home';
  const authed = await ensureAuth();

  if (!authed && route !== 'oauth') {
    navigate('oauth');
    return;
  }
  if (authed && route === 'oauth') {
    navigate('home');
    return;
  }

  for (const [name, el] of Object.entries(pages)) {
    el.hidden = name !== route;
  }
  appNav.style.display = route === 'oauth' ? 'none' : 'flex';
  activeRoute = route;

  document.querySelectorAll('.app-nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.route === route);
  });

  // 卸载旧页面的清理逻辑
  if (pageMounted && pageMounted.cleanup) {
    pageMounted.cleanup();
  }
  pageMounted = null;

  const mount = pageMounts[route];
  if (mount) {
    pageMounted = (await mount()) || null;
  }
  updateFab();
}

window.addEventListener('hashchange', handleRouteChange);

/* 悬浮按钮：runner 运行中且不在 runner/oauth 页 */

async function updateFab() {
  if (activeRoute === 'oauth' || activeRoute === 'runner') {
    fabRunner.hidden = true;
    return;
  }
  try {
    const status = await api.center.getRunnerRuntimeStatus();
    fabRunner.hidden = !status.running;
  } catch {
    fabRunner.hidden = true;
  }
}

fabRunner.addEventListener('click', () => navigate('runner'));

/* ================= 后台轮询与降载 ================= */

// 窗口隐藏到托盘时停掉定时轮询，避免后台空转反复唤醒渲染/主进程；重新显示时恢复
let fabTimer = null;
let runnerTimer = null;
let runnerSync = null;

function startFabTimer() {
  if (fabTimer !== null) {
    return;
  }
  fabTimer = setInterval(() => {
    if (activeRoute !== 'oauth' && activeRoute !== 'runner') {
      updateFab();
    }
  }, 3000);
}

function stopFabTimer() {
  if (fabTimer !== null) {
    clearInterval(fabTimer);
    fabTimer = null;
  }
}

function startRunnerTimer() {
  if (runnerTimer !== null || typeof runnerSync !== 'function' || document.hidden) {
    return;
  }
  runnerTimer = setInterval(() => runnerSync(), 1200);
}

function stopRunnerTimer() {
  if (runnerTimer !== null) {
    clearInterval(runnerTimer);
    runnerTimer = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopFabTimer();
    stopRunnerTimer();
    return;
  }
  startFabTimer();
  startRunnerTimer();
  updateFab();
});

/* ================= 首页 ================= */

function greeting() {
  const hour = new Date().getHours();
  if (hour < 6 || hour >= 22) return '夜深了，早点休息喵';
  if (hour < 9) return '早上好~ 又是元气满满的一天呢';
  if (hour < 12) return '上午好，加油喵';
  if (hour < 14) return '中午好，记得吃饭哦';
  if (hour < 18) return '下午好，继续加油w';
  return '晚上好，记得放松一下喵';
}

function buildTrafficChart(dailyStats) {
  if (!dailyStats || dailyStats.length === 0) {
    return '<div class="hint-text">暂无流量数据</div>';
  }
  const width = 720;
  const height = 300;
  const padX = 40;
  const padTop = 30;
  const padBottom = 40;
  const points = dailyStats.map((stat) => Number(stat.total_traffic || 0) / (1024 * 1024 * 1024));
  const max = Math.max(...points, 0.001);
  const stepX = points.length > 1 ? (width - padX * 2) / (points.length - 1) : 0;

  const coords = points.map((value, i) => [
    padX + i * stepX,
    padTop + (height - padTop - padBottom) * (1 - value / max),
  ]);

  const linePath = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${coords[coords.length - 1][0].toFixed(1)},${height - padBottom} L${coords[0][0].toFixed(1)},${height - padBottom} Z`;

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  };

  const ticks = coords
    .map(([x, y], i) => {
      if (i === 0 || i === coords.length - 1) return '';
      return `<text x="${x}" y="${height - padBottom + 20}" font-size="11" fill="currentColor" opacity="0.5" text-anchor="middle">${escapeHtml(formatDate(dailyStats[i].date))}</text>`;
    })
    .join('');

  const dots = coords
    .map(([x, y], i) => {
      const stat = dailyStats[i];
      const tunnels = (stat.tunnel_stats || [])
        .map((t) => `${t.remark || t.tunnel_name}: ${(Number(t.total_traffic || 0) / 1024 ** 3).toFixed(2)}GB`)
        .join('\n');
      const tip = `${formatDate(stat.date)}\n${points[i].toFixed(2)} GB${tunnels ? '\n' + tunnels : ''}`;
      return `<circle cx="${x}" cy="${y}" r="4" fill="var(--ls-accent, #F06292)" opacity="0.9"><title>${escapeHtml(tip)}</title></circle>`;
    })
    .join('');

  return `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
      <line x1="${padX}" y1="${height - padBottom}" x2="${width - padX}" y2="${height - padBottom}" stroke="currentColor" opacity="0.15"/>
      <path d="${areaPath}" fill="var(--ls-accent, #F06292)" opacity="0.1"/>
      <path d="${linePath}" fill="none" stroke="var(--ls-accent, #F06292)" stroke-width="3"/>
      ${dots}
      ${ticks}
      <text x="${padX}" y="${height - padBottom + 20}" font-size="11" fill="currentColor" opacity="0.5">${escapeHtml(formatDate(dailyStats[0].date))}</text>
      <text x="${width - padX}" y="${height - padBottom + 20}" font-size="11" fill="currentColor" opacity="0.5" text-anchor="end">${escapeHtml(formatDate(dailyStats[dailyStats.length - 1].date))}</text>
    </svg>`;
}

async function mountHome() {
  const el = pages.home;
  el.innerHTML = `
    <div class="mdui-card home-hero" style="margin-bottom:16px">
      <div class="home-avatar" id="home-avatar"><i class="material-icons">person</i></div>
      <div>
        <div class="mdui-typo-title" id="home-greeting" style="margin:0">${escapeHtml(greeting())}</div>
        <div class="mdui-typo-subheading-opacity" id="home-email">-</div>
      </div>
    </div>

    <div class="mdui-card" style="margin-bottom:16px">
      <div class="mdui-row">
        <div class="mdui-col-xs-12 mdui-col-sm-4 stat-cell">
          <div class="stat-icon"><i class="material-icons" style="font-size:18px">show_chart</i></div>
          <div class="stat-label">可用流量</div>
          <div class="stat-value" id="stat-traffic">-</div>
        </div>
        <div class="mdui-col-xs-12 mdui-col-sm-4 stat-cell">
          <div class="stat-icon"><i class="material-icons" style="font-size:18px">dns</i></div>
          <div class="stat-label">隧道数量</div>
          <div class="stat-value" id="stat-tunnels">-</div>
        </div>
        <div class="mdui-col-xs-12 mdui-col-sm-4 stat-cell">
          <div class="stat-icon"><i class="material-icons" style="font-size:18px">speed</i></div>
          <div class="stat-label">带宽限制</div>
          <div class="stat-value" id="stat-bandwidth">-</div>
        </div>
      </div>
    </div>

    <div class="mdui-card">
      <div class="card-title-row">
        <div>
          <div class="stat-label">近七天流量使用</div>
          <div class="mdui-typo-title" style="margin:0" id="chart-total">-</div>
        </div>
      </div>
      <div class="chart-box" id="chart-box"><div class="hint-text">加载中…</div></div>
    </div>`;

  try {
    const [dashboard, daily] = await withLoading(async () =>
      Promise.all([api.center.getDashboard(), api.center.getTrafficDaily(7)]),
    );

    const user = dashboard.user || {};
    const traffic = dashboard.traffic || {};
    const trafficLimit = Number(traffic.traffic_limit ?? user.traffic_limit ?? 0);
    const trafficUsed = Number(traffic.traffic_used ?? user.traffic_used ?? 0);
    const remaining = Number(traffic.traffic_remaining ?? Math.max(trafficLimit - trafficUsed, 0));

    document.getElementById('home-greeting').textContent = `${user.username || '-'}，${greeting()}`;
    document.getElementById('home-email').textContent = user.email || '-';
    if (user.avatar) {
      document.getElementById('home-avatar').innerHTML = `<img src="${escapeHtml(user.avatar)}" alt="avatar" referrerpolicy="no-referrer">`;
    }
    document.getElementById('stat-traffic').textContent = formatBytes(remaining);
    document.getElementById('stat-tunnels').textContent = `${dashboard.tunnel?.count ?? 0} / ${user.max_tunnel_count ?? 0}`;
    const bw = Number(user.bandwidth_limit);
    document.getElementById('stat-bandwidth').textContent = Number.isFinite(bw) && bw > 0 ? `${Math.round(bw * 8)} Mbps` : '-';

    const stats = daily.daily_stats || [];
    const total = stats.reduce((acc, s) => acc + Number(s.total_traffic || 0), 0) / 1024 ** 3;
    document.getElementById('chart-total').textContent = `${total.toFixed(2)} GB`;
    document.getElementById('chart-box').innerHTML = buildTrafficChart(stats);
  } catch (error) {
    const box = document.getElementById('chart-box');
    box.innerHTML = `<div class="inline-alert error">${escapeHtml(error.message || '加载主页数据失败')}</div>`;
  }
  mdui.mutation();
}

/* ================= 隧道页 ================= */

function tunnelTarget(tunnel) {
  const customDomain = (tunnel.custom_domain || '').trim();
  if (customDomain) return customDomain;
  const nodeAddress = (tunnel.node_address || '').trim();
  if (nodeAddress) return `${nodeAddress}:${tunnel.remote_port}`;
  if (tunnel.remote_port > 0) return `端口 ${tunnel.remote_port}`;
  return '-';
}

function tunnelStatusBadge(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'active') return '<span class="badge success"><span class="dot"></span>运行中</span>';
  if (normalized === 'inactive') return '<span class="badge grey"><span class="dot"></span>已停止</span>';
  return `<span class="badge info"><span class="dot"></span>${escapeHtml(status || '未知')}</span>`;
}

async function mountTunnels() {
  const el = pages.tunnels;
  el.innerHTML = `
    <div class="mdui-card tunnel-toolbar">
      <div class="mdui-textfield mdui-textfield-floating-label">
        <i class="material-icons">search</i>
        <label class="mdui-textfield-label">搜索隧道</label>
        <input class="mdui-textfield-input" type="text" id="tunnel-search" />
      </div>
      <button class="mdui-btn mdui-ripple mdui-color-theme" id="tunnel-refresh">
        <i class="material-icons mdui-left mdui-icon">refresh</i>刷新
      </button>
    </div>
    <div id="tunnel-list"></div>`;

  let tunnels = [];
  let runnerStatus = { running: false, tunnel_names: [], tunnel_name: '' };
  const listEl = document.getElementById('tunnel-list');
  const searchEl = document.getElementById('tunnel-search');

  const isStarted = (name) =>
    runnerStatus.running &&
    ((runnerStatus.tunnel_names || []).some((n) => n.trim() === name.trim()) ||
      (runnerStatus.tunnel_name || '').trim() === name.trim());

  function renderList() {
    const keyword = searchEl.value.trim().toLowerCase();
    const filtered = keyword
      ? tunnels.filter((tunnel) =>
          [tunnel.name, tunnel.type, tunnel.remark, tunnel.custom_domain, tunnel.local_ip, tunnel.local_port, tunnel.remote_port, tunnel.id]
            .join(' ')
            .toLowerCase()
            .includes(keyword),
        )
      : tunnels;

    if (filtered.length === 0) {
      listEl.innerHTML = `
        <div class="mdui-card empty-state">
          <i class="material-icons">folder_open</i>
          <div class="mdui-typo-title">暂无可展示的隧道</div>
          <div class="mdui-typo-caption-opacity">你可以尝试刷新或调整搜索条件</div>
          <button class="mdui-btn mdui-ripple mdui-color-theme" id="tunnel-reload" style="margin-top:16px">
            <i class="material-icons mdui-left mdui-icon">refresh</i>重新加载
          </button>
        </div>`;
      const btn = document.getElementById('tunnel-reload');
      if (btn) btn.addEventListener('click', load);
      return;
    }

    listEl.innerHTML = `<div class="tunnel-grid">${filtered
      .map(
        (tunnel) => `
      <div class="mdui-card tunnel-card">
        <div class="tunnel-card-head">
          <div class="tunnel-name" title="${escapeHtml(tunnel.remark || tunnel.name)}">${escapeHtml(tunnel.remark || tunnel.name)}</div>
          ${tunnelStatusBadge(tunnel.status)}
        </div>
        <div>
          <div class="tunnel-row"><span class="tunnel-label">本地</span><code class="mono">${escapeHtml(tunnel.local_ip)}:${tunnel.local_port}</code></div>
          <div class="tunnel-row"><span class="tunnel-label">目标</span><code class="mono" title="${escapeHtml(tunnelTarget(tunnel))}">${escapeHtml(tunnelTarget(tunnel))}</code></div>
        </div>
        <div class="tunnel-chips">
          <span class="badge info">${escapeHtml(String(tunnel.type || '-').toUpperCase())}</span>
          <span class="badge grey"><i class="material-icons" style="font-size:12px">dns</i>${escapeHtml(tunnel.node_name || '-')}</span>
        </div>
        <div class="tunnel-traffic">
          <span><i class="material-icons" style="color:#4caf50">download</i>${formatBytes(Number(tunnel.total_in ?? 0))}</span>
          <span><i class="material-icons" style="color:#2196f3">upload</i>${formatBytes(Number(tunnel.total_out ?? 0))}</span>
        </div>
        <div class="tunnel-actions">
          <button class="mdui-btn mdui-ripple mdui-btn-sm" data-start="${escapeHtml(tunnel.name)}" ${isStarted(tunnel.name) ? 'disabled' : ''}>
            <i class="material-icons mdui-left mdui-icon">play_arrow</i>${isStarted(tunnel.name) ? '已启动' : '启动'}
          </button>
          <button class="mdui-btn mdui-ripple mdui-btn-sm" data-detail="${escapeHtml(tunnel.name)}">
            <i class="material-icons mdui-left mdui-icon">visibility</i>详情
          </button>
        </div>
      </div>`,
      )
      .join('')}</div>`;

    listEl.querySelectorAll('[data-start]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const name = btn.dataset.start;
        btn.disabled = true;
        try {
          await withLoading(() => api.center.startRunner([name]));
          await load();
          navigate('runner');
        } catch (error) {
          showMessage(error.message || '启动隧道失败，请稍后重试', 'error');
          btn.disabled = false;
        }
      });
    });
    listEl.querySelectorAll('[data-detail]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.detail.trim();
        if (name) {
          api.shell.openExternal(`https://dash.lolia.link/dash/tunnel/${encodeURIComponent(name)}`);
        }
      });
    });
    mdui.mutation();
  }

  async function load() {
    try {
      const [overview, status] = await withLoading(async () =>
        Promise.all([api.center.getTunnelsOverview(1, 100, 2), api.center.getRunnerRuntimeStatus()]),
      );
      tunnels = overview.list || [];
      runnerStatus = status || runnerStatus;
    } catch (error) {
      listEl.innerHTML = `<div class="inline-alert error">${escapeHtml(error.message || '加载隧道列表失败，请稍后重试')}</div>`;
      return;
    }
    renderList();
  }

  searchEl.addEventListener('input', renderList);
  document.getElementById('tunnel-refresh').addEventListener('click', load);
  await load();
  mdui.mutation();
}

/* ================= Runner 页 ================= */

async function mountRunner() {
  const el = pages.runner;
  el.innerHTML = `
    <div id="runner-alert"></div>
    <div class="mdui-card runner-hero">
      <div style="flex:1;min-width:220px">
        <div class="mdui-typo-title" style="margin:0">LoliaCLI Runner</div>
        <div class="mdui-typo-caption-opacity" id="runner-sub">-</div>
        <div class="runner-badges" id="runner-badges"></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="mdui-btn mdui-ripple mdui-color-theme" id="runner-start"><i class="material-icons mdui-left mdui-icon">play_arrow</i>启动</button>
        <button class="mdui-btn mdui-ripple" id="runner-stop"><i class="material-icons mdui-left mdui-icon">stop</i>停止</button>
        <button class="mdui-btn mdui-ripple" id="runner-refresh"><i class="material-icons mdui-left mdui-icon">refresh</i>刷新</button>
      </div>
    </div>

    <div class="runner-grid">
      <div class="mdui-card runner-col-card">
        <div class="card-title-row">
          <div style="font-weight:600">隧道状态</div>
          <span class="badge info" id="runner-rule-count">0 条规则</span>
        </div>
        <div class="card-body" id="runner-tunnels"></div>
      </div>
      <div class="mdui-card runner-col-card">
        <div class="card-title-row">
          <div>
            <div style="font-weight:600">frpc 运行日志</div>
            <div class="mdui-typo-caption-opacity" id="runner-command" style="font-size:12px">启动命令：-</div>
          </div>
        </div>
        <div class="card-body"><pre class="log-panel" id="runner-logs">加载中…</pre></div>
      </div>
    </div>`;

  let runtimeStatus = { running: false, pid: 0, tunnel_names: [], tunnel_name: '', log_lines: [], node_address: '', command: '' };
  let tunnelRows = [];
  let summary = { server: '-', protocol: '-', version: '-', pid: '-', startTime: '-' };
  let actionBusy = false;

  const joinHostPort = (host, port) => {
    const h = String(host || '').trim();
    if (!h) return '-';
    if (!port || port <= 0) return h;
    return `${h}:${port}`;
  };

  const activeTunnelNames = () => {
    const names = (runtimeStatus.tunnel_names || []).filter((n) => n.trim());
    if (names.length) return names;
    const fallback = (runtimeStatus.tunnel_name || '').trim();
    return fallback ? [fallback] : [];
  };

  const activeTunnels = () =>
    runtimeStatus.running ? tunnelRows.filter((t) => activeTunnelNames().includes(t.name)) : [];

  const resolveServer = (fallback) => {
    const actives = activeTunnels();
    if (actives.length > 1) return `${actives.length} 条隧道`;
    const customDomain = (actives[0]?.customDomain || '').trim();
    if (customDomain) return customDomain;
    const nodeAddress = (runtimeStatus.node_address || '').trim();
    if (!nodeAddress) return fallback;
    return joinHostPort(nodeAddress, actives[0]?.remotePort);
  };

  const resolveProtocol = (fallback) => {
    const actives = activeTunnels();
    if (!actives.length) return fallback;
    const protocols = new Set(actives.map((t) => t.type.trim().toUpperCase()).filter(Boolean));
    if (protocols.size === 1) return [...protocols][0];
    if (protocols.size > 1) return 'MULTI';
    return fallback;
  };

  function render() {
    const alertEl = document.getElementById('runner-alert');
    if (runtimeStatus.last_error) {
      alertEl.innerHTML = `<div class="inline-alert warning" style="margin-bottom:12px">上次运行错误：${escapeHtml(runtimeStatus.last_error)}</div>`;
    } else {
      alertEl.innerHTML = '';
    }

    document.getElementById('runner-sub').textContent = `已连接至 Runner ${summary.server !== '-' ? `(${summary.server})` : ''}（${summary.protocol}）`;
    const running = runtimeStatus.running;
    document.getElementById('runner-badges').innerHTML = `
      <span class="badge ${running ? 'success' : 'warning'}"><span class="dot"></span>${running ? '运行中' : '未运行'}</span>
      <span class="badge grey">PID ${escapeHtml(summary.pid)}</span>
      <span class="badge info">${escapeHtml(summary.version)}</span>
      <span class="badge grey">启动于 ${escapeHtml(summary.startTime)}</span>`;

    document.getElementById('runner-command').textContent = `启动命令：${runtimeStatus.command || '-'}`;

    const actives = activeTunnels();
    document.getElementById('runner-rule-count').textContent = `${actives.length} 条规则`;
    const tunnelsEl = document.getElementById('runner-tunnels');
    if (actives.length === 0) {
      tunnelsEl.innerHTML = `<div class="hint-text" style="padding:8px">Runner 未运行，暂无已启动隧道。</div>`;
    } else {
      tunnelsEl.innerHTML = actives
        .map((tunnel) => {
          const remote = tunnel.customDomain || tunnel.remote || joinHostPort(runtimeStatus.node_address, tunnel.remotePort);
          return `
          <div class="tunnel-status-item">
            <div style="min-width:0">
              <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(tunnel.remark)}</div>
              <div class="mdui-typo-caption-opacity" style="font-size:12px">${escapeHtml(tunnel.local)} → ${escapeHtml(remote)}</div>
            </div>
            <span class="badge ${tunnel.statusColor}"><span class="dot"></span>${escapeHtml(tunnel.status)}</span>
          </div>`;
        })
        .join('');
    }

    const logsEl = document.getElementById('runner-logs');
    const lines = runtimeStatus.log_lines || [];
    logsEl.textContent = lines.length ? lines.join('\n') : '暂无日志，点击“启动”后可查看 frpc 输出。';
    logsEl.scrollTop = logsEl.scrollHeight;

    document.getElementById('runner-start').disabled = running || actionBusy;
    document.getElementById('runner-stop').disabled = !running || actionBusy;
  }

  async function loadRunnerData() {
    try {
      const [runnerData, tunnelData, runtime] = await withLoading(async () =>
        Promise.all([
          api.center.getRunnerData(0),
          api.center.getTunnelsOverview(1, 100, 2),
          api.center.getRunnerRuntimeStatus(),
        ]),
      );
      runtimeStatus = runtime || runtimeStatus;

      const nodeMap = new Map();
      for (const node of runnerData.nodes || []) {
        nodeMap.set(Number(node.id), { ip_address: node.ip_address || '-', frps_port: Number(node.frps_port || 0) });
      }

      tunnelRows = (tunnelData.list || []).map((item) => {
        const node = nodeMap.get(Number(item.node_id));
        const remoteHost = (item.node_address || '').trim() || node?.ip_address || 'node';
        const customDomain = (item.custom_domain || '').trim();
        const statusText = statusToText(item.status);
        return {
          name: item.name,
          remark: item.remark || item.name,
          type: item.type || '-',
          customDomain,
          local: `${item.local_ip}:${item.local_port}`,
          remote: customDomain || joinHostPort(remoteHost, item.remote_port || 0),
          remotePort: item.remote_port || 0,
          status: statusText,
          statusColor: statusToColor(item.status),
        };
      });

      const currentNode = runnerData.current_tunnel ? nodeMap.get(Number(runnerData.current_tunnel.node_id)) : undefined;
      const fallbackNodeAddress = currentNode
        ? joinHostPort(currentNode.ip_address, currentNode.frps_port || runnerData.current_tunnel?.remote_port)
        : runnerData.nodes?.[0]
          ? joinHostPort(runnerData.nodes[0].ip_address, runnerData.nodes[0].frps_port)
          : '-';

      summary = {
        server: resolveServer(fallbackNodeAddress),
        protocol: resolveProtocol((runnerData.current_tunnel?.type || '-').toUpperCase()),
        version: runnerData.version || '-',
        pid: runtimeStatus.pid > 0 ? String(runtimeStatus.pid) : '-',
        startTime: runtimeStatus.started_at ? new Date(runtimeStatus.started_at).toLocaleString() : '-',
      };
    } catch (error) {
      document.getElementById('runner-alert').innerHTML = `<div class="inline-alert error" style="margin-bottom:12px">${escapeHtml(error.message || '加载 Runner 数据失败，请稍后重试')}</div>`;
    }
    render();
  }

  async function syncRuntime() {
    try {
      const status = await api.center.getRunnerRuntimeStatus();
      if (!status) return;
      runtimeStatus = status;
      summary = {
        ...summary,
        server: resolveServer(summary.server),
        protocol: resolveProtocol(summary.protocol),
        pid: status.pid > 0 ? String(status.pid) : '-',
        startTime: status.started_at ? new Date(status.started_at).toLocaleString() : '-',
      };
      render();
    } catch {
      /* 忽略轮询错误 */
    }
  }

  const startBtn = document.getElementById('runner-start');
  const stopBtn = document.getElementById('runner-stop');
  startBtn.addEventListener('click', async () => {
    actionBusy = true;
    render();
    try {
      await withLoading(() => api.center.startRunner([]));
      await loadRunnerData();
    } catch (error) {
      showMessage(error.message || '启动 runner 失败，请稍后重试', 'error');
    } finally {
      actionBusy = false;
      loadRunnerData();
    }
  });
  stopBtn.addEventListener('click', async () => {
    actionBusy = true;
    render();
    try {
      await withLoading(() => api.center.stopRunner());
      await loadRunnerData();
    } catch (error) {
      showMessage(error.message || '停止 runner 失败，请稍后重试', 'error');
    } finally {
      actionBusy = false;
      loadRunnerData();
    }
  });
  document.getElementById('runner-refresh').addEventListener('click', loadRunnerData);

  await loadRunnerData();
  runnerSync = syncRuntime;
  startRunnerTimer();
  mdui.mutation();

  return {
    cleanup() {
      runnerSync = null;
      stopRunnerTimer();
    },
  };
}

function statusToColor(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized.includes('run') || normalized.includes('online')) return 'success';
  if (normalized.includes('error') || normalized.includes('fail')) return 'error';
  if (normalized.includes('stop') || normalized.includes('offline')) return 'grey';
  return 'info';
}

function statusToText(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized.includes('run') || normalized.includes('online')) return '在线';
  if (normalized.includes('error') || normalized.includes('fail')) return '异常';
  if (normalized.includes('stop') || normalized.includes('offline')) return '离线';
  return status || '未知';
}

/* ================= 设置页 ================= */

async function mountSettings() {
  const el = pages.settings;
  let activePanel = 'frpc';
  let status = null;
  let installing = false;
  let canceling = false;
  let progress = { phase: 'idle', downloaded: 0, total: 0, percent: 0 };
  let showMirrorSwitchHint = false;

  const mirrorModeItems = [
    { title: 'github.com', value: 'official' },
    { title: '内置镜像', value: 'builtin' },
    { title: '自定义网址', value: 'custom' },
  ];

  el.innerHTML = `
    <div class="settings-layout">
      <div class="mdui-card settings-menu">
        <div class="mdui-list" style="padding:0">
          <div class="mdui-subheader">设置菜单</div>
          <a class="mdui-list-item settings-menu-item" data-panel="frpc"><i class="material-icons mdui-list-item-icon">cloud_download</i><div class="mdui-list-item-content">frpc 管理</div></a>
          <a class="mdui-list-item settings-menu-item" data-panel="general"><i class="material-icons mdui-list-item-icon">tune</i><div class="mdui-list-item-content">常规</div></a>
          <a class="mdui-list-item settings-menu-item" data-panel="appearance"><i class="material-icons mdui-list-item-icon">palette</i><div class="mdui-list-item-content">外观</div></a>
          <a class="mdui-list-item settings-menu-item" data-panel="about"><i class="material-icons mdui-list-item-icon">info</i><div class="mdui-list-item-content">关于</div></a>
          <a class="mdui-list-item settings-menu-item" data-panel="account"><i class="material-icons mdui-list-item-icon">person</i><div class="mdui-list-item-content">账号</div></a>
        </div>
      </div>
      <div class="mdui-card">
        <div class="card-title-row">
          <div style="font-weight:600" id="settings-panel-title">frpc 管理</div>
          <span class="badge info" id="settings-platform" hidden></span>
        </div>
        <div class="settings-panel" id="settings-panel-body"></div>
      </div>
    </div>`;

  const panelTitleEl = document.getElementById('settings-panel-title');
  const panelBodyEl = document.getElementById('settings-panel-body');
  const platformEl = document.getElementById('settings-platform');

  const panelTitles = {
    frpc: 'frpc 管理',
    general: '常规设置',
    appearance: '外观设置',
    about: '关于',
    account: '账号',
  };

  function syncMirrorForm() {
    const config = status?.mirror_config || { mode: 'official' };
    form.mirrorMode = config.mode || 'official';
    form.presetID = config.preset_id || (status?.builtin_mirrors?.[0]?.id ?? '');
    form.customBaseURL = config.custom_base_url || '';
    form.customTemplate = config.custom_url_template || '';
    form.customMode = form.customTemplate ? 'template' : 'base';
  }

  const form = {
    mirrorMode: 'official',
    presetID: '',
    customBaseURL: '',
    customTemplate: '',
    customMode: 'base',
  };

  const phaseLabels = {
    resolving: '正在获取最新版本…',
    downloading: '正在下载…',
    verifying: '正在校验文件…',
    extracting: '正在解压安装…',
    done: '安装完成',
    idle: '准备中…',
  };

  function frpcStatusChip() {
    const installed = !!status?.installed?.binary_exists;
    if (!installed) return { text: '未安装', cls: 'grey' };
    if (status?.latest_error) return { text: '已安装', cls: 'success' };
    if (status?.update_available) return { text: '可更新', cls: 'warning' };
    return { text: '已是最新', cls: 'success' };
  }

  function renderFrpcPanel() {
    const chip = frpcStatusChip();
    const installedVersion = status?.installed?.version || '未安装';
    const latestVersion = status?.latest?.tag_name || '-';
    const actionText = !status?.installed?.binary_exists ? '安装 frpc' : status?.update_available ? '更新 frpc' : '重装 frpc';
    const indeterminate = installing && (progress.phase !== 'downloading' || progress.total <= 0);
    const progressDetail =
      progress.phase === 'downloading' && progress.total > 0
        ? `${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)}`
        : '';

    const mirrorOptions = mirrorModeItems
      .map((item) => `<option value="${item.value}" ${form.mirrorMode === item.value ? 'selected' : ''}>${item.title}</option>`)
      .join('');

    const builtinOptions = (status?.builtin_mirrors || [])
      .map(
        (preset) =>
          `<option value="${escapeHtml(preset.id)}" ${form.presetID === preset.id ? 'selected' : ''}>${escapeHtml(preset.name || preset.id)}（${escapeHtml(preset.description || preset.base_url || preset.url_template || '')}）</option>`,
      )
      .join('');

    panelBodyEl.innerHTML = `
      <div class="frpc-hero">
        <div style="flex:1;min-width:180px">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-size:18px;font-weight:600">frpc</span>
            ${status?.installed?.binary_exists ? `<span class="badge success">${escapeHtml(installedVersion)}</span>` : ''}
            <span class="badge ${chip.cls}"><span class="dot"></span>${chip.text}</span>
          </div>
          <div class="sub">最新 ${escapeHtml(latestVersion)}</div>
        </div>
        <button class="mdui-btn mdui-ripple" id="frpc-install" ${installing ? 'disabled' : ''}>
          <i class="material-icons mdui-left mdui-icon">file_download</i>${actionText}
        </button>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="mdui-btn mdui-ripple" id="frpc-cancel" ${!installing || canceling ? 'disabled' : ''}><i class="material-icons mdui-left mdui-icon">stop</i>终止下载</button>
        <button class="mdui-btn mdui-ripple" id="frpc-check" ${installing ? 'disabled' : ''}><i class="material-icons mdui-left mdui-icon">refresh</i>检查更新</button>
        <button class="mdui-btn mdui-ripple" id="frpc-remove" ${installing ? 'disabled' : ''}><i class="material-icons mdui-left mdui-icon">delete</i>删除本地 frpc</button>
      </div>

      ${installing
        ? `<div class="soft-card">
            <div style="display:flex;justify-content:space-between;margin-bottom:8px">
              <span style="font-size:13px">${phaseLabels[progress.phase] || '准备中…'}</span>
              <span class="mdui-typo-caption-opacity">${progressDetail}${progress.phase === 'downloading' && progress.total > 0 ? ` ${Math.floor(progress.percent)}%` : ''}</span>
            </div>
            ${indeterminate
              ? '<div class="mdui-progress mdui-progress-indeterminate"><div class="mdui-progress-indeterminate"></div></div>'
              : `<div class="mdui-progress"><div class="mdui-progress-determinate" style="width:${Math.floor(progress.percent)}%"></div></div>`}
          </div>`
        : ''}

      ${showMirrorSwitchHint
        ? '<div class="inline-alert warning">frpc 下载失败或超时，可能是当前下载源网络不佳，建议在下方「GitHub 下载源」中切换镜像后重试。</div>'
        : ''}
      ${status?.latest_error
        ? `<div class="inline-alert warning">获取最新版本失败：${escapeHtml(status.latest_error)}</div>`
        : ''}

      <div class="install-details">
        <div class="soft-card">
          <h4>安装状态</h4>
          <div class="detail-row"><i class="material-icons">label</i><span class="label">当前版本</span><span class="value">${escapeHtml(installedVersion)}</span></div>
          <div class="detail-row"><i class="material-icons">memory</i><span class="label">二进制</span><span class="value">${status?.installed?.binary_exists ? '已安装' : '未安装'}</span></div>
          <div class="detail-row"><i class="material-icons">schedule</i><span class="label">安装时间</span><span class="value">${escapeHtml(formatTime(status?.installed?.installed_at))}</span></div>
        </div>
        <div class="soft-card">
          <h4>最新版本</h4>
          <div class="detail-row"><i class="material-icons">style</i><span class="label">最新标签</span><span class="value">${escapeHtml(latestVersion)}</span></div>
          <div class="detail-row"><i class="material-icons">upgrade</i><span class="label">可更新</span><span class="value">${status?.update_available ? '是' : '否'}</span></div>
        </div>
      </div>

      <div class="soft-card">
        <h4>GitHub 下载源</h4>
        <div style="margin-bottom:12px">
          <select class="mdui-select" id="mirror-mode" style="width:100%" ${installing ? 'disabled' : ''}>${mirrorOptions}</select>
        </div>
        ${form.mirrorMode === 'builtin'
          ? `<select class="mdui-select" id="mirror-preset" style="width:100%;margin-bottom:12px" ${installing ? 'disabled' : ''}>${builtinOptions || '<option value="">当前没有可用的内置镜像</option>'}</select>`
          : ''}
        ${form.mirrorMode === 'custom'
          ? `
          <select class="mdui-select" id="mirror-custom-mode" style="width:100%;margin-bottom:12px" ${installing ? 'disabled' : ''}>
            <option value="base" ${form.customMode === 'base' ? 'selected' : ''}>基础地址</option>
            <option value="template" ${form.customMode === 'template' ? 'selected' : ''}>URL 模板</option>
          </select>
          <div class="mdui-textfield">
            <input class="mdui-textfield-input" type="text" id="mirror-custom-input" ${installing ? 'disabled' : ''}
              value="${escapeHtml(form.customMode === 'template' ? form.customTemplate : form.customBaseURL)}"
              placeholder="${form.customMode === 'template' ? 'https://mirrors.example.com/{owner}/{repo}/{tag}/{asset}' : 'https://example.com/github.com'}" />
            ${form.customMode === 'template' ? '<div class="hint-text">可用占位符：{owner}、{repo}、{tag}、{asset}</div>' : ''}
          </div>`
          : ''}
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="mdui-btn mdui-ripple mdui-color-theme" id="mirror-save" ${installing ? 'disabled' : ''}>保存设置</button>
          <button class="mdui-btn mdui-ripple" id="mirror-official" ${installing ? 'disabled' : ''}>使用 github.com</button>
        </div>
      </div>

      <div class="soft-card">
        <h4>本地目录</h4>
        ${[
          ['userdata', status?.paths?.userdata_dir],
          ['frpc', status?.paths?.frpc_dir],
          ['bin', status?.paths?.bin_dir],
          ['binary', status?.paths?.binary_path],
          ['downloads', status?.paths?.download_dir],
          ['state', status?.paths?.state_path],
          ['settings', status?.paths?.settings_path],
        ]
          .map(
            ([label, value]) => `
          <div class="frpc-path-row">
            <span class="frpc-path-label">${label}</span>
            <code class="frpc-path-value" title="${escapeHtml(value || '')}">${escapeHtml(value || '-')}</code>
            <button class="mdui-btn mdui-btn-icon mdui-ripple mdui-ripple-black" style="width:28px;height:28px" data-copy="${escapeHtml(value || '')}" ${!value ? 'disabled' : ''}><i class="material-icons" style="font-size:16px">content_copy</i></button>
          </div>`,
          )
          .join('')}
      </div>`;

    document.getElementById('frpc-install').addEventListener('click', handleInstall);
    document.getElementById('frpc-cancel').addEventListener('click', handleCancel);
    document.getElementById('frpc-check').addEventListener('click', loadStatus);
    document.getElementById('frpc-remove').addEventListener('click', handleRemove);
    document.getElementById('mirror-save').addEventListener('click', handleSaveMirror);
    document.getElementById('mirror-official').addEventListener('click', () => {
      form.mirrorMode = 'official';
      form.customBaseURL = '';
      form.customTemplate = '';
      handleSaveMirror();
    });

    const mirrorModeSelect = document.getElementById('mirror-mode');
    mirrorModeSelect.addEventListener('change', () => {
      form.mirrorMode = mirrorModeSelect.value;
      renderFrpcPanel();
    });
    const presetSelect = document.getElementById('mirror-preset');
    if (presetSelect) {
      presetSelect.addEventListener('change', () => {
        form.presetID = presetSelect.value;
      });
    }
    const customModeSelect = document.getElementById('mirror-custom-mode');
    if (customModeSelect) {
      customModeSelect.addEventListener('change', () => {
        if (customModeSelect.value === 'template') {
          form.customBaseURL = document.getElementById('mirror-custom-input')?.value || form.customBaseURL;
        } else {
          form.customTemplate = document.getElementById('mirror-custom-input')?.value || form.customTemplate;
        }
        form.customMode = customModeSelect.value;
        renderFrpcPanel();
      });
    }
    panelBodyEl.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const value = btn.dataset.copy;
        if (!value) return;
        try {
          await navigator.clipboard.writeText(value);
          showMessage('已复制路径', 'success');
        } catch {
          showMessage('复制失败', 'error');
        }
      });
    });
    mdui.mutation();
  }

  async function renderGeneralPanel() {
    let closeAction = 'tray';
    let autoLaunch = false;
    try {
      closeAction = await api.app.getCloseAction();
    } catch {
      // 读取失败时沿用默认值展示
    }
    try {
      autoLaunch = await api.app.getAutoLaunch();
    } catch {
      // 读取失败时按未开启展示
    }
    panelBodyEl.innerHTML = `
      <div class="soft-card">
        <h4>开机启动</h4>
        <label class="mdui-switch">
          <input type="checkbox" id="auto-launch" ${autoLaunch ? 'checked' : ''}/>
          <i class="mdui-switch-icon"></i>
          <span>开机时自动启动</span>
        </label>
        <div class="hint-text">开启后，登录系统时会自动启动本程序。</div>
      </div>
      <div class="soft-card">
        <h4>关闭按钮行为</h4>
        <select class="mdui-select" id="close-action" style="width:100%">
          <option value="tray" ${closeAction === 'tray' ? 'selected' : ''}>最小化到托盘</option>
          <option value="quit" ${closeAction === 'quit' ? 'selected' : ''}>直接退出</option>
        </select>
        <div class="hint-text">选择「最小化到托盘」时，点关闭按钮会隐藏窗口，frpc 继续在后台运行；可点击托盘图标重新打开，或在托盘菜单里退出。</div>
      </div>`;

    document.getElementById('auto-launch').addEventListener('change', async (event) => {
      try {
        await api.app.setAutoLaunch(event.target.checked);
        showMessage(event.target.checked ? '已开启开机启动' : '已关闭开机启动', 'success');
      } catch (error) {
        showMessage(error.message || '保存失败', 'error');
        renderGeneralPanel();
      }
    });

    document.getElementById('close-action').addEventListener('change', async (event) => {
      const value = event.target.value;
      try {
        await api.app.setCloseAction(value);
        showMessage('已更新关闭按钮行为', 'success');
      } catch (error) {
        showMessage(error.message || '保存失败', 'error');
      }
      renderGeneralPanel();
    });
    mdui.mutation();
  }

  function renderAppearancePanel() {
    const themeMode = currentThemeMode();
    panelBodyEl.innerHTML = `
      <div class="soft-card">
        <h4>主题模式</h4>
        <select class="mdui-select" id="theme-mode" style="width:100%">
          <option value="auto" ${themeMode === 'auto' ? 'selected' : ''}>跟随系统</option>
          <option value="light" ${themeMode === 'light' ? 'selected' : ''}>浅色模式</option>
          <option value="dark" ${themeMode === 'dark' ? 'selected' : ''}>深色模式</option>
        </select>
        <div class="hint-text">支持跟随系统、浅色、深色模式，设置会自动保存到本地。</div>
      </div>
      <div class="soft-card">
        <h4>强调色</h4>
        <div class="accent-swatches">
          ${accentPresets
            .map(
              (preset) => `
            <button type="button" class="accent-swatch ${currentAccentId() === preset.id ? 'active' : ''}" data-accent="${preset.id}" title="${preset.name}" style="background:${isDarkActive() ? preset.dark : preset.light}">
              ${currentAccentId() === preset.id ? '<i class="material-icons" style="font-size:16px">check</i>' : ''}
            </button>`,
            )
            .join('')}
        </div>
        <div class="hint-text">强调色会应用到按钮、链接等主色元素，选择即时生效并保存到本地。</div>
      </div>`;

    document.getElementById('theme-mode').addEventListener('change', (event) => {
      writeStorage(themeStorageKey, event.target.value);
      applyTheme();
      showMessage('主题已切换', 'success');
      renderAppearancePanel();
    });
    panelBodyEl.querySelectorAll('[data-accent]').forEach((btn) => {
      btn.addEventListener('click', () => {
        writeStorage(accentStorageKey, btn.dataset.accent);
        applyTheme();
        showMessage('强调色已更新', 'success');
        renderAppearancePanel();
      });
    });
    mdui.mutation();
  }

  async function renderAboutPanel() {
    let info = null;
    try {
      info = await api.app.getVersionInfo();
    } catch {
      info = null;
    }
    const electronVer = info ? `Electron ${info.electron_version}` : '-';
    panelBodyEl.innerHTML = `
      <div class="about-hero">
        <div class="about-logo">🍋</div>
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-size:20px;font-weight:600">LoliaNeko</span>
            <span class="badge grey">v${escapeHtml(info?.version || '-')}</span>
          </div>
          <div style="opacity:0.9;font-size:13px;margin-top:4px">「ロリア・猫」由 Electron 驱动的 Lolia FRP 第三方客户端</div>
        </div>
      </div>
      <div class="soft-card">
        <h4>构建信息</h4>
        <div class="about-grid">
          ${[
            ['版本', info?.version],
            ['提交', info?.git_commit],
            ['分支', info?.git_branch],
            ['构建时间', info?.build_time],
            ['平台', info?.platform],
            ['运行时', electronVer],
          ]
            .map(
              ([label, value]) => `
            <div>
              <div class="label">${label}</div>
              <div class="value">${escapeHtml(value || '-')}</div>
            </div>`,
            )
            .join('')}
        </div>
      </div>
      <div class="soft-card">
        <h4>相关链接</h4>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="mdui-btn mdui-ripple mdui-color-theme" data-link="https://github.com/latt-tech/LoliaNeko"><i class="material-icons mdui-left mdui-icon">link</i>项目仓库</button>
          <button class="mdui-btn mdui-ripple" data-link="https://dash.lolia.link"><i class="material-icons mdui-left mdui-icon">dashboard</i>Lolia 控制台</button>
          <button class="mdui-btn mdui-ripple" data-link="https://lolia.link"><i class="material-icons mdui-left mdui-icon">language</i>Lolia 官网</button>
          <button class="mdui-btn mdui-ripple" data-license><i class="material-icons mdui-left mdui-icon">description</i>开源许可</button>
        </div>
      </div>
      <div class="mdui-typo-caption-opacity" style="text-align:center">以 MIT 许可证开源 · Made with ♥ by Whirity404</div>`;

    panelBodyEl.querySelectorAll('[data-link]').forEach((btn) => {
      btn.addEventListener('click', () => api.shell.openExternal(btn.dataset.link));
    });
    panelBodyEl.querySelectorAll('[data-license]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api.shell.openLicense();
        } catch (err) {
          showMessage(err.message || '无法打开开源许可', 'error');
        }
      });
    });
    mdui.mutation();
  }

  function renderAccountPanel() {
    panelBodyEl.innerHTML = `
      <div class="inline-alert warning">退出后将清除本地 OAuth 凭据，并停止当前本地 Runner。</div>
      <div>
        <button class="mdui-btn mdui-ripple mdui-color-theme" id="account-logout"><i class="material-icons mdui-left mdui-icon">logout</i>退出登录</button>
      </div>`;
    document.getElementById('account-logout').addEventListener('click', handleLogout);
    mdui.mutation();
  }

  function renderPanel() {
    panelTitleEl.textContent = panelTitles[activePanel];
    platformEl.hidden = activePanel !== 'frpc' || !status;
    if (status) {
      platformEl.textContent = `${status.goos}/${status.goarch}`;
    }
    document.querySelectorAll('.settings-menu-item').forEach((item) => {
      item.classList.toggle('mdui-active', item.dataset.panel === activePanel);
    });
    switch (activePanel) {
      case 'frpc':
        renderFrpcPanel();
        break;
      case 'general':
        renderGeneralPanel();
        break;
      case 'appearance':
        renderAppearancePanel();
        break;
      case 'about':
        renderAboutPanel();
        break;
      case 'account':
        renderAccountPanel();
        break;
    }
  }

  document.querySelectorAll('.settings-menu-item').forEach((item) => {
    item.addEventListener('click', () => {
      activePanel = item.dataset.panel;
      renderPanel();
    });
  });

  async function loadStatus() {
    try {
      status = await withLoading(() => api.frpc.getFrpcStatus());
      syncMirrorForm();
    } catch (error) {
      showMessage(error.message || '获取 frpc 状态失败', 'error');
    }
    if (activePanel === 'frpc') {
      renderFrpcPanel();
    }
  }

  async function handleInstall() {
    if (installing) return;
    showMirrorSwitchHint = false;
    installing = true;
    progress = { phase: 'resolving', downloaded: 0, total: 0, percent: 0 };
    renderFrpcPanel();
    try {
      const result = await api.frpc.installOrUpdateFrpc();
      status = result.status;
      syncMirrorForm();
      showMessage(`frpc 已安装到 ${result.status.paths.binary_path}`, 'success');
    } catch (error) {
      const message = error.message || '安装/更新 frpc 失败';
      if (message.includes('已终止')) {
        showMessage(message, 'info');
        await loadStatus();
        return;
      }
      if (message.includes('下载失败') || message.includes('下载超时')) {
        showMirrorSwitchHint = true;
      }
      showMessage(message, 'error');
    } finally {
      installing = false;
      canceling = false;
      progress = { phase: 'idle', downloaded: 0, total: 0, percent: 0 };
      renderFrpcPanel();
    }
  }

  async function handleCancel() {
    if (!installing || canceling) return;
    canceling = true;
    try {
      await api.frpc.cancelInstallOrUpdateFrpc();
      showMessage('已发送终止下载请求', 'info');
    } catch (error) {
      showMessage(error.message || '终止下载失败', 'error');
    } finally {
      canceling = false;
    }
  }

  async function handleRemove() {
    try {
      await withLoading(() => api.frpc.removeFrpc());
      showMessage('本地 frpc 已移除', 'success');
      await loadStatus();
    } catch (error) {
      showMessage(error.message || '移除 frpc 失败', 'error');
    }
  }

  async function handleSaveMirror() {
    const input = document.getElementById('mirror-custom-input');
    if (input) {
      if (form.customMode === 'template') {
        form.customTemplate = input.value.trim();
      } else {
        form.customBaseURL = input.value.trim();
      }
    }
    const config = { mode: form.mirrorMode };
    try {
      if (form.mirrorMode === 'builtin') {
        if (!form.presetID) {
          showMessage('请选择一个内置镜像', 'error');
          return;
        }
        config.preset_id = form.presetID;
      } else if (form.mirrorMode === 'custom') {
        if (form.customMode === 'template') {
          if (!form.customTemplate) {
            showMessage('请填写自定义 URL 模板', 'error');
            return;
          }
          config.custom_url_template = form.customTemplate;
        } else {
          if (!form.customBaseURL) {
            showMessage('请填写自定义镜像基础地址', 'error');
            return;
          }
          config.custom_base_url = form.customBaseURL;
        }
      }
      await withLoading(() => api.frpc.setMirrorConfig(config));
      showMirrorSwitchHint = false;
      showMessage('下载源设置已保存', 'success');
      await loadStatus();
    } catch (error) {
      showMessage(error.message || '保存下载源失败', 'error');
    }
  }

  async function handleLogout() {
    const btn = document.getElementById('account-logout');
    if (btn) btn.disabled = true;
    try {
      await api.center.stopRunner().catch(() => {});
      await api.token.clearOAuthToken();
      showMessage('已退出登录', 'success');
      navigate('oauth');
    } catch (error) {
      showMessage(error.message || '退出登录失败', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  const offProgress = api.frpc.onInstallProgress((payload) => {
    if (!payload) return;
    progress = {
      phase: payload.phase || progress.phase,
      downloaded: payload.downloaded ?? progress.downloaded,
      total: payload.total ?? progress.total,
      percent: payload.percent ?? progress.percent,
    };
    if (activePanel === 'frpc' && installing) {
      renderFrpcPanel();
    }
  });

  await loadStatus();
  renderPanel();

  return {
    cleanup() {
      offProgress();
    },
  };
}

function formatTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

/* ================= OAuth 页 ================= */

async function mountOAuth() {
  const loginBtn = document.getElementById('oauth-login');
  const msgEl = document.getElementById('oauth-msg');

  const showMsg = (text, type) => {
    msgEl.hidden = false;
    msgEl.className = `oauth-msg ${type}`;
    msgEl.textContent = text;
  };

  const handler = async () => {
    msgEl.hidden = true;
    loginBtn.disabled = true;
    loginBtn.innerHTML = '<i class="material-icons mdui-left mdui-icon mdui-spin">sync</i>正在登录…';
    try {
      const ok = await api.token.beginOAuthLogin();
      if (!ok) {
        throw new Error('OAuth 授权失败，请重试。');
      }
      showMsg('登录成功，正在跳转...', 'success');
      await handleRouteChange();
    } catch (error) {
      showMsg(error.message || 'OAuth 登录失败，请稍后重试。', 'error');
    } finally {
      loginBtn.disabled = false;
      loginBtn.innerHTML = '<i class="material-icons mdui-left mdui-icon">arrow_forward</i>使用 Lolia FRP 账号登录';
    }
  };

  loginBtn.addEventListener('click', handler);
  mdui.mutation();

  return {
    cleanup() {
      loginBtn.removeEventListener('click', handler);
    },
  };
}

/* ================= 页面注册表 ================= */

const pageMounts = {
  home: mountHome,
  oauth: mountOAuth,
  tunnels: mountTunnels,
  runner: mountRunner,
  settings: mountSettings,
};

/* ================= 窗口控制 ================= */

const winMaxBtn = document.getElementById('win-max');

// 与 index.html 中的数字实体保持一致：e835 最大化 / e3c8 还原
const ICON_MAXIMIZE = '\ue835';
const ICON_RESTORE = '\ue835';

function syncMaxIcon(maximised) {
  winMaxBtn.querySelector('i').textContent = maximised ? ICON_RESTORE : ICON_MAXIMIZE;
  winMaxBtn.title = maximised ? '还原' : '最大化';
}

document.getElementById('win-min').addEventListener('click', () => api.window.minimize());
winMaxBtn.addEventListener('click', async () => {
  const maximised = await api.window.toggleMaximize();
  syncMaxIcon(maximised);
});
document.getElementById('win-close').addEventListener('click', () => api.window.close());

api.window.onChanged((info) => {
  if (info && typeof info.maximised === 'boolean') {
    syncMaxIcon(info.maximised);
  }
});

/* ================= 启动 ================= */

(async function bootstrap() {
  applyTheme();
  api.window.isMaximized().then(syncMaxIcon);
  await handleRouteChange();

  // 定期刷新悬浮按钮状态（隐藏到托盘时由 visibilitychange 暂停）
  startFabTimer();
})();
