'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createClient } = require('../httpclient');
const { centerAPIBaseURL } = require('../api-center');

const AdmZip = require('adm-zip');
const tar = require('tar');

const defaultFrpcRepoOwner = 'Lolia-FRP';
const defaultFrpcRepoName = 'lolia-frp';
const defaultFrpcDownloadTimeoutMs = 2 * 60 * 1000;
const frpcVersionProbeTimeoutMs = 3000;

const MIRROR_MODE_OFFICIAL = 'official';
const MIRROR_MODE_BUILTIN = 'builtin';
const MIRROR_MODE_CUSTOM = 'custom';

const PROGRESS_EMIT_INTERVAL_MS = 150;

const defaultBuiltinFrpcMirrors = [
  {
    id: 'milu',
    name: 'gh.milu.moe',
    description: 'Milu GitHub 镜像',
    base_url: 'https://gh.milu.moe',
  },
  {
    id: 'akaere',
    name: 'cdn.akaere.online',
    description: 'Akaere GitHub 路径镜像',
    base_url: 'https://cdn.akaere.online/github.com',
  },
  {
    id: 'xiaomocs',
    name: 'hub.xiaomocs.com',
    description: 'XiaoMo GitHub 路径镜像',
    base_url: 'https://hub.xiaomocs.com/github',
  },
  {
    id: 'locyan',
    name: 'mirrors.locyan.cn',
    description: '乐青云镜像',
    url_template: 'https://mirrors.locyan.cn/github-release/{owner}/{repo}/Release%20{tag}/{asset}',
  },
];

function frpcBinaryName() {
  return process.platform === 'win32' ? 'frpc.exe' : 'frpc';
}

function normalizeMirrorURL(rawURL) {
  const trimmed = String(rawURL || '').trim();
  if (!trimmed) {
    return '';
  }
  const parsed = new URL(trimmed);
  if (!parsed.protocol || !parsed.host) {
    throw new Error('invalid mirror base url');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('mirror base url must start with http:// or https://');
  }
  return trimmed.replace(/\/+$/, '');
}

function sameNormalizedURL(left, right) {
  try {
    return normalizeMirrorURL(left) === normalizeMirrorURL(right);
  } catch {
    return false;
  }
}

function normalizeMirrorTemplate(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    return '';
  }
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    throw new Error('mirror url template must start with http:// or https://');
  }
  if (!['{owner}', '{repo}', '{tag}', '{asset}'].some((token) => trimmed.includes(token))) {
    throw new Error('mirror url template must contain at least one supported placeholder');
  }
  return trimmed;
}

function normalizeMirrorConfig(config) {
  const mode = String(config?.mode || '').trim() || MIRROR_MODE_OFFICIAL;
  const normalized = { mode };

  switch (mode) {
    case MIRROR_MODE_OFFICIAL:
      return normalized;
    case MIRROR_MODE_BUILTIN: {
      normalized.preset_id = String(config?.preset_id || '').trim();
      if (!normalized.preset_id) {
        throw new Error('builtin mirror preset is required');
      }
      if (!findBuiltinMirrorPreset(normalized.preset_id)) {
        throw new Error(`unknown builtin mirror preset: ${normalized.preset_id}`);
      }
      return normalized;
    }
    case MIRROR_MODE_CUSTOM: {
      const baseURL = normalizeMirrorURL(config?.custom_base_url || '');
      const urlTemplate = normalizeMirrorTemplate(config?.custom_url_template || '');
      if (!baseURL && !urlTemplate) {
        throw new Error('custom mirror base url or url template is required');
      }
      if (baseURL && urlTemplate) {
        throw new Error('custom mirror base url and url template cannot both be set');
      }
      if (baseURL) {
        normalized.custom_base_url = baseURL;
      }
      if (urlTemplate) {
        normalized.custom_url_template = urlTemplate;
      }
      return normalized;
    }
    default:
      throw new Error(`unsupported mirror mode: ${mode}`);
  }
}

function findBuiltinMirrorPreset(id) {
  const needle = String(id || '').trim();
  if (!needle) {
    return null;
  }
  return defaultBuiltinFrpcMirrors.find((preset) => preset.id === needle) || null;
}

function legacyMirrorConfig(rawURL) {
  const trimmed = String(rawURL || '').trim();
  if (!trimmed) {
    return { mode: MIRROR_MODE_OFFICIAL };
  }
  for (const preset of defaultBuiltinFrpcMirrors) {
    if (preset.base_url && sameNormalizedURL(preset.base_url, trimmed)) {
      return { mode: MIRROR_MODE_BUILTIN, preset_id: preset.id };
    }
  }
  return { mode: MIRROR_MODE_CUSTOM, custom_base_url: trimmed };
}

function legacyMirrorURLFromConfig(config) {
  switch (String(config?.mode || '').trim()) {
    case MIRROR_MODE_BUILTIN: {
      const preset = findBuiltinMirrorPreset(config.preset_id);
      return preset ? String(preset.base_url || '').trim() : '';
    }
    case MIRROR_MODE_CUSTOM:
      return String(config.custom_base_url || '').trim();
    default:
      return '';
  }
}

function applyMirrorURL(rawURL, mirrorURL) {
  const urlValue = String(rawURL || '').trim();
  if (!urlValue) {
    return urlValue;
  }
  let mirror = String(mirrorURL || '').trim();
  if (!mirror) {
    return urlValue;
  }
  try {
    const parsed = new URL(urlValue);
    const base = mirror.replace(/\/+$/, '');
    const p = (parsed.pathname || '').replace(/^\/+/, '');
    let rebuilt = base;
    if (p) {
      rebuilt += '/' + p;
    }
    if (parsed.search) {
      rebuilt += parsed.search;
    }
    if (parsed.hash) {
      rebuilt += parsed.hash;
    }
    return rebuilt;
  } catch {
    if (!mirror.endsWith('/')) {
      mirror += '/';
    }
    return mirror + urlValue.replace(/^\/+/, '');
  }
}

function parseGitHubReleaseDownloadURL(parsedURL) {
  const segments = (parsedURL.pathname || '').split('/').filter(Boolean);
  if (segments.length < 5) {
    return null;
  }
  if (segments[2] !== 'releases' || segments[3] !== 'download') {
    return null;
  }
  return {
    owner: segments[0],
    repo: segments[1],
    tag: segments[4],
    asset: segments[segments.length - 1],
  };
}

function applyMirrorTemplate(rawURL, urlTemplate) {
  const urlValue = String(rawURL || '').trim();
  const template = String(urlTemplate || '').trim();
  if (!urlValue) {
    throw new Error('download url is empty');
  }
  if (!template) {
    throw new Error('mirror url template is empty');
  }
  const parsed = new URL(urlValue);
  const releaseInfo = parseGitHubReleaseDownloadURL(parsed) || { owner: '', repo: '', tag: '', asset: '' };

  const replaced = template
    .replaceAll('{owner}', releaseInfo.owner)
    .replaceAll('{repo}', releaseInfo.repo)
    .replaceAll('{tag}', releaseInfo.tag)
    .replaceAll('{asset}', releaseInfo.asset);

  const parsedResult = new URL(replaced);
  if (!parsedResult.protocol || !parsedResult.host) {
    throw new Error('mirror url template resolved to invalid url');
  }
  if (parsedResult.protocol !== 'http:' && parsedResult.protocol !== 'https:') {
    throw new Error('mirror url template resolved to non-http url');
  }
  return replaced;
}

function applyMirrorDefinition(rawURL, baseURL, urlTemplate) {
  if (String(urlTemplate || '').trim()) {
    return applyMirrorTemplate(rawURL, urlTemplate);
  }
  if (String(baseURL || '').trim()) {
    return applyMirrorURL(rawURL, baseURL);
  }
  throw new Error('mirror definition is empty');
}

function resolveMirrorURL(rawURL, config) {
  const urlValue = String(rawURL || '').trim();
  if (!urlValue) {
    throw new Error('download url is empty');
  }
  switch (String(config?.mode || '').trim()) {
    case '':
    case MIRROR_MODE_OFFICIAL:
      return urlValue;
    case MIRROR_MODE_BUILTIN: {
      const preset = findBuiltinMirrorPreset(config.preset_id);
      if (!preset) {
        throw new Error(`unknown builtin mirror preset: ${config.preset_id}`);
      }
      return applyMirrorDefinition(urlValue, preset.base_url, preset.url_template);
    }
    case MIRROR_MODE_CUSTOM:
      return applyMirrorDefinition(urlValue, config.custom_base_url, config.custom_url_template);
    default:
      throw new Error(`unsupported mirror mode: ${config.mode}`);
  }
}

function releaseAssetName(platform, arch) {
  switch (platform) {
    case 'win32':
      if (['ia32', 'x64', 'arm', 'arm64'].includes(arch)) {
        return { name: `LoliaFrp_windows_${arch === 'x64' ? 'amd64' : arch}.zip`, format: 'zip' };
      }
      break;
    case 'linux':
    case 'darwin':
    case 'freebsd':
    case 'openbsd':
      if (['ia32', 'x64', 'arm', 'arm64'].includes(arch)) {
        const goos = platform === 'darwin' ? 'darwin' : platform;
        const goarch = arch === 'x64' ? 'amd64' : arch === 'ia32' ? '386' : arch;
        return { name: `LoliaFrp_${goos}_${goarch}.tar.gz`, format: 'tar.gz' };
      }
      break;
    case 'android':
      if (['arm', 'arm64'].includes(arch)) {
        return { name: `LoliaFrp_android_${arch}.tar.gz`, format: 'tar.gz' };
      }
      break;
  }
  throw new Error(`unsupported platform: ${platform}/${arch}`);
}

function parseSHA256Digest(raw) {
  let digest = String(raw || '').trim().toLowerCase();
  digest = digest.replace(/^sha256:/, '');
  if (digest.length !== 64 || !/^[0-9a-f]+$/.test(digest)) {
    return '';
  }
  return digest;
}

function normalizeInstalledVersionForCompare(raw) {
  let version = String(raw || '').trim();
  if (!version) {
    return '';
  }
  if (version.toLowerCase() === 'unknown') {
    return 'unknown';
  }
  const fields = version.split(/\s+/);
  if (fields.length >= 2 && fields[0].toLowerCase() === 'loliafrp-cli') {
    version = fields[1].trim();
  } else if (fields.length >= 2) {
    version = fields[fields.length - 1].trim();
  }
  version = version.replace(/^[vV]/, '');
  if (!version) {
    return '';
  }
  return 'LoliaFRP-CLI ' + version;
}

function normalizeGitHubTagForCompare(tag) {
  const version = String(tag || '').trim().replace(/^[vV]/, '');
  if (!version) {
    return '';
  }
  return 'LoliaFRP-CLI ' + version;
}

function isUpdateAvailable(installed, latest) {
  if (!latest) {
    return false;
  }
  if (!installed) {
    return true;
  }
  const installedVersion = normalizeInstalledVersionForCompare(installed.version);
  const latestVersion = normalizeGitHubTagForCompare(latest.tag_name);
  if (!installedVersion || installedVersion === 'unknown') {
    return true;
  }
  if (!latestVersion) {
    return true;
  }
  return installedVersion !== latestVersion;
}

function createFrpcService() {
  let installSession = null;

  function paths() {
    const { app } = require('electron');
    const appDir = app.getPath('userData');
    const userDataDir = path.join(appDir, 'userdata');
    const frpcDir = path.join(userDataDir, 'frpc');
    const binDir = path.join(frpcDir, 'bin');
    const downloadDir = path.join(frpcDir, 'downloads');
    return {
      userdata_dir: userDataDir,
      frpc_dir: frpcDir,
      bin_dir: binDir,
      binary_path: path.join(binDir, frpcBinaryName()),
      download_dir: downloadDir,
      state_path: path.join(frpcDir, 'installed.json'),
      settings_path: path.join(frpcDir, 'settings.json'),
    };
  }

  function loadUserSettings() {
    const p = paths();
    try {
      const raw = fs.readFileSync(p.settings_path, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return {};
      }
      throw new Error(`read frpc settings: ${err.message}`);
    }
  }

  function saveUserSettings(settings) {
    const p = paths();
    fs.mkdirSync(p.frpc_dir, { recursive: true });
    fs.writeFileSync(p.settings_path, JSON.stringify(settings, null, 2), 'utf8');
  }

  function getMirrorConfig() {
    const settings = loadUserSettings();
    if (!String(settings.mirror_config?.mode || '').trim()) {
      return legacyMirrorConfig(settings.github_mirror_url);
    }
    try {
      return normalizeMirrorConfig(settings.mirror_config);
    } catch {
      return { mode: MIRROR_MODE_OFFICIAL };
    }
  }

  function setMirrorConfig(config) {
    const normalized = normalizeMirrorConfig(config);
    const settings = loadUserSettings();
    settings.github_mirror_url = '';
    settings.mirror_config = normalized;
    saveUserSettings(settings);
  }

  function detectFrpcVersion(binaryPath) {
    const { execFileSync } = require('child_process');
    let output = '';
    try {
      output = execFileSync(binaryPath, ['-v'], { timeout: frpcVersionProbeTimeoutMs, windowsHide: true }).toString();
    } catch {
      return '';
    }
    const line = output.trim();
    if (!line) {
      return '';
    }
    const fields = line.split(/\s+/);
    return fields.length >= 2 ? fields[1].trim() : '';
  }

  function loadInstalledInfo() {
    const p = paths();
    let exists = false;
    try {
      exists = fs.statSync(p.binary_path).isFile();
    } catch {
      exists = false;
    }

    let state;
    try {
      state = JSON.parse(fs.readFileSync(p.state_path, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') {
        if (!exists) {
          return null;
        }
        let version = 'unknown';
        const detected = detectFrpcVersion(p.binary_path);
        if (detected) {
          version = detected;
        }
        return {
          version,
          binary_path: p.binary_path,
          binary_exists: true,
        };
      }
      throw new Error(`read frpc install state: ${err.message}`);
    }

    let version = String(state.version || '').trim() || 'unknown';
    if (exists && version === 'unknown') {
      const detected = detectFrpcVersion(p.binary_path);
      if (detected) {
        version = detected;
      }
    }

    return {
      version,
      asset_name: state.asset_name || '',
      sha256: String(state.sha256 || '').trim().toLowerCase(),
      installed_at: state.installed_at || '',
      binary_path: p.binary_path,
      binary_exists: exists,
    };
  }

  async function resolveLatestRelease() {
    const repoOwner = (process.env.LOLIA_FRPC_REPO_OWNER || '').trim() || defaultFrpcRepoOwner;
    const repoName = (process.env.LOLIA_FRPC_REPO_NAME || '').trim() || defaultFrpcRepoName;

    const client = createClient({ baseURL: centerAPIBaseURL() });
    const release = await client.doJSON('GET', '/client/version');

    const tag = String(release?.tag || '').trim();
    if (!tag) {
      throw new Error('client version tag is empty');
    }

    const archMap = { x64: 'amd64', ia32: '386', arm: 'arm', arm64: 'arm64' };
    const { name: assetName, format: archiveFormat } = releaseAssetName(process.platform, process.arch);

    let selected = null;
    for (const asset of release?.assets || []) {
      if (String(asset.name || '').trim().toLowerCase() === assetName.toLowerCase()) {
        selected = asset;
        break;
      }
    }
    if (!selected) {
      throw new Error(`latest release does not contain asset ${assetName}`);
    }

    const downloadURL = `https://github.com/${repoOwner}/${repoName}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(selected.name)}`;
    const goos = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : process.platform;
    const goarch = archMap[process.arch] || process.arch;

    return {
      tag_name: tag,
      name: String(release?.version || '').trim(),
      html_url: `https://github.com/${repoOwner}/${repoName}/releases/tag/${encodeURIComponent(tag)}`,
      asset: {
        name: selected.name,
        download_url: downloadURL,
        digest: selected.hash || '',
        sha256: parseSHA256Digest(selected.hash),
        os: goos,
        arch: goarch,
        archive_format: archiveFormat,
        size: Number(selected.size) || 0,
      },
    };
  }

  async function buildStatus(fetchLatest, latestOverride, sendProgress) {
    const p = paths();
    const installed = loadInstalledInfo();
    const mirrorConfig = getMirrorConfig();

    const status = {
      goos: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : process.platform,
      goarch: process.arch,
      paths: p,
      github_mirror_url: legacyMirrorURLFromConfig(mirrorConfig),
      mirror_config: mirrorConfig,
      builtin_mirrors: defaultBuiltinFrpcMirrors.map((preset) => ({ ...preset })),
      installed,
      update_available: false,
    };

    let latest = latestOverride || null;
    if (fetchLatest && !latest) {
      try {
        latest = await resolveLatestRelease();
      } catch (err) {
        status.latest_error = err.message;
        return status;
      }
    }
    if (latest) {
      status.latest = latest;
      status.update_available = isUpdateAvailable(installed, latest);
    }
    return status;
  }

  async function getFrpcStatus() {
    return buildStatus(true, null);
  }

  async function downloadArchive(url, outputPath, expectedSize, sendProgress) {
    const downloadURL = resolveMirrorURL(String(url || '').trim(), getMirrorConfig());
    const session = installSession;
    const timer = setTimeout(() => {
      session.timedOut = true;
      session.controller.abort();
    }, defaultFrpcDownloadTimeoutMs);

    let resp;
    try {
      resp = await fetch(downloadURL, {
        signal: session.controller.signal,
        headers: {
          'User-Agent': (process.env.LOLIA_HTTP_USER_AGENT || '').trim() || require('../version').userAgent(),
        },
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(session.timedOut ? 'frpc 下载超时，可尝试切换下载源后重试' : 'frpc 下载已终止');
      }
      throw new Error(`download release asset: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      throw new Error(`download release asset failed: status=${resp.status}`);
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const tempPath = outputPath + '.tmp';
    const fileStream = fs.createWriteStream(tempPath);

    const total = Number(resp.headers.get('content-length')) || expectedSize || 0;
    const hasher = crypto.createHash('sha256');
    let downloaded = 0;
    let lastEmit = 0;

    try {
      const reader = resp.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        hasher.update(value);
        downloaded += value.length;
        fileStream.write(Buffer.from(value));

        const now = Date.now();
        if (now - lastEmit >= PROGRESS_EMIT_INTERVAL_MS) {
          lastEmit = now;
          sendProgress('downloading', downloaded, total);
        }
      }
      sendProgress('downloading', downloaded, total);
    } catch (err) {
      fileStream.destroy();
      fs.rmSync(tempPath, { force: true });
      if (err.name === 'AbortError') {
        throw new Error(session.timedOut ? 'frpc 下载超时，可尝试切换下载源后重试' : 'frpc 下载已终止');
      }
      throw new Error(`write archive file: ${err.message}`);
    }

    await new Promise((resolve, reject) => {
      fileStream.on('finish', resolve);
      fileStream.on('error', reject);
      fileStream.end();
    });

    fs.renameSync(tempPath, outputPath);
    return hasher.digest('hex');
  }

  function findFileRecursive(dir, name) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = findFileRecursive(full, name);
        if (nested) {
          return nested;
        }
      } else if (entry.name === name) {
        return full;
      }
    }
    return null;
  }

  async function extractBinaryFromArchive(archivePath, archiveFormat, binaryName, outputPath) {
    const format = String(archiveFormat || '').trim().toLowerCase();
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const tempPath = outputPath + '.tmp';

    if (format === 'zip') {
      const zip = new AdmZip(archivePath);
      const entries = zip.getEntries().filter((e) => !e.isDirectory && path.basename(e.entryName) === binaryName);
      if (entries.length === 0) {
        throw new Error(`binary ${binaryName} not found in zip archive`);
      }
      fs.writeFileSync(tempPath, entries[0].getData());
    } else if (format === 'tar.gz') {
      const tmpDir = archivePath + '.extract';
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.mkdirSync(tmpDir, { recursive: true });
      try {
        await tar.extract({ file: archivePath, cwd: tmpDir });
        const found = findFileRecursive(tmpDir, binaryName);
        if (!found) {
          throw new Error(`binary ${binaryName} not found in tar.gz archive`);
        }
        fs.copyFileSync(found, tempPath);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } else {
      throw new Error(`unsupported archive format: ${archiveFormat}`);
    }

    if (process.platform !== 'win32') {
      fs.chmodSync(tempPath, 0o755);
    }
    fs.rmSync(outputPath, { force: true });
    fs.renameSync(tempPath, outputPath);
  }

  async function installOrUpdateFrpc(sendProgress) {
    if (installSession) {
      throw new Error('frpc 下载/安装正在进行中');
    }
    installSession = { controller: new AbortController(), timedOut: false };

    const noopProgress = () => {};
    const progress = typeof sendProgress === 'function' ? sendProgress : noopProgress;

    try {
      progress('resolving', 0, 0);
      const latest = await resolveLatestRelease();

      const p = paths();
      fs.mkdirSync(p.bin_dir, { recursive: true });
      fs.mkdirSync(p.download_dir, { recursive: true });

      const archivePath = path.join(p.download_dir, latest.asset.name);
      let downloadedSHA256;
      try {
        downloadedSHA256 = await downloadArchive(latest.asset.download_url, archivePath, latest.asset.size, progress);
      } catch (err) {
        if (err.message && err.message.includes('下载')) {
          throw err;
        }
        throw new Error(`frpc 下载失败：${err.message}，可尝试切换下载源后重试`);
      }

      progress('verifying', 0, 0);
      const expectedSHA256 = String(latest.asset.sha256 || '').trim().toLowerCase();
      if (!expectedSHA256) {
        throw new Error(`release asset digest is empty: ${latest.asset.name}`);
      }
      if (downloadedSHA256 !== expectedSHA256) {
        throw new Error(`sha256 mismatch for ${latest.asset.name}: expected=${expectedSHA256} actual=${downloadedSHA256}`);
      }

      progress('extracting', 0, 0);
      await extractBinaryFromArchive(archivePath, latest.asset.archive_format, path.basename(p.binary_path), p.binary_path);

      let version = latest.tag_name;
      const detected = detectFrpcVersion(p.binary_path);
      if (detected) {
        version = detected;
      }

      const state = {
        version,
        asset_name: latest.asset.name,
        sha256: downloadedSHA256,
        installed_at: new Date().toISOString(),
      };
      fs.mkdirSync(path.dirname(p.state_path), { recursive: true });
      fs.writeFileSync(p.state_path, JSON.stringify(state, null, 2), 'utf8');
      fs.rmSync(archivePath, { force: true });

      const status = await buildStatus(false, latest);
      progress('done', latest.asset.size, latest.asset.size);

      return { release: latest, status };
    } finally {
      installSession = null;
    }
  }

  function cancelInstallOrUpdateFrpc() {
    if (installSession) {
      installSession.controller.abort();
    }
  }

  function removeFrpc() {
    const p = paths();
    fs.rmSync(p.binary_path, { force: true });
    fs.rmSync(p.state_path, { force: true });
  }

  function getGitHubMirrorURL() {
    const config = getMirrorConfig();
    switch (config.mode) {
      case MIRROR_MODE_BUILTIN: {
        const preset = findBuiltinMirrorPreset(config.preset_id);
        return preset ? String(preset.base_url || '').trim() : '';
      }
      case MIRROR_MODE_CUSTOM:
        return String(config.custom_base_url || '').trim();
      default:
        return '';
    }
  }

  function setGitHubMirrorURL(rawURL) {
    const mirrorURL = String(rawURL || '').trim();
    if (!mirrorURL) {
      return setMirrorConfig({ mode: MIRROR_MODE_OFFICIAL });
    }
    for (const preset of defaultBuiltinFrpcMirrors) {
      if (preset.base_url && sameNormalizedURL(preset.base_url, mirrorURL)) {
        return setMirrorConfig({ mode: MIRROR_MODE_BUILTIN, preset_id: preset.id });
      }
    }
    return setMirrorConfig({ mode: MIRROR_MODE_CUSTOM, custom_base_url: mirrorURL });
  }

  return {
    getFrpcStatus,
    installOrUpdateFrpc,
    cancelInstallOrUpdateFrpc,
    removeFrpc,
    getGitHubMirrorURL,
    setGitHubMirrorURL,
    getMirrorConfig,
    setMirrorConfig,
  };
}

module.exports = { createFrpcService };
