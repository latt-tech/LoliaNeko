'use strict';

const { app } = require('electron');

const AppName = 'LoliaNeko';
const GitCommit = process.env.LOLIA_GIT_COMMIT || 'dev';
const GitBranch = process.env.LOLIA_GIT_BRANCH || 'dev';
const BuildTime = process.env.LOLIA_BUILD_TIME || 'unknown';

function shortCommit() {
  const commit = String(GitCommit).trim();
  if (commit.length > 7) {
    return commit.slice(0, 7);
  }
  return commit || 'unknown';
}

function getInfo() {
  return {
    app_name: AppName,
    version: app.getVersion(),
    git_commit: shortCommit(),
    git_branch: GitBranch,
    build_time: BuildTime,
    electron_version: process.versions.electron,
    node_version: process.versions.node,
    platform: `${process.platform}/${process.arch}`,
  };
}

function userAgent() {
  const info = getInfo();
  return `${info.app_name}/${info.version} (${info.platform}; ${info.git_commit})`;
}

module.exports = { getInfo, userAgent, shortCommit };
