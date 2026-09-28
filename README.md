![LoliaNeko](https://socialify.git.ci/Whirity404/LoliaNeko/image?description=1&forks=1&issues=1&language=1&name=1&owner=1&pulls=1&stargazers=1&theme=Auto)

# LoliaNeko

「ロリア・猫」由 Electron 驱动的 Lolia FRP 第三方客户端

## 功能概览

- OAuth 登录
- 控制台数据看板（用户信息、流量、隧道、版本）
- 隧道列表与流量概览
- 本地 Runner 启停与日志查看
- 内置 frpc 安装/更新/移除

## 技术栈

- 桌面框架：Electron 28（Node.js 主进程 + contextIsolation/preload IPC）
- 渲染层：原生 HTML/CSS/JS + MDUI v1（unpkg CDN）
- 打包：electron-builder（Windows nsis / portable）

## 环境要求

- Node.js `>= 18`

## 本地开发

在仓库根目录运行：

```bash
npm install
npm start
```

## 构建

在仓库根目录运行：

```bash
npm run dist
```

产物输出到 `dist/`。

## OAuth 与认证说明

Token 经 Electron `safeStorage`（Windows DPAPI）加密后存储于 `userData/token.json`。

默认 OAuth 回调地址为 `http://localhost:11419`（监听 `0.0.0.0:11419`）。
桌面端登录固定使用 Authorization Code + PKCE。

## 配置项（环境变量）

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `LOLIA_CENTER_API_BASE_URL` | 中心 API 基地址 | `https://api.lolia.link/api/v1` |
| `LOLIA_HTTP_USER_AGENT` | 自定义请求 UA | — |
| `LOLIA_OAUTH_CLIENT_ID` | OAuth Client ID | — |
| `LOLIA_OAUTH_AUTHORIZE_URL` | OAuth 授权地址 | `https://dash.lolia.link/oauth/authorize` |
| `LOLIA_OAUTH_TOKEN_URL` | OAuth Token 地址 | `https://api.lolia.link/api/v1/oauth2/token` |
| `LOLIA_OAUTH_REDIRECT_URL` | OAuth 回调地址 | `http://localhost:11419` |
| `LOLIA_FRPC_REPO_OWNER` | frpc Release 仓库 Owner | `Lolia-FRP` |
| `LOLIA_FRPC_REPO_NAME` | frpc Release 仓库名 | `lolia-frp` |

## frpc 本地目录

frpc 安装在 Electron `userData`（Windows 下为 `%APPDATA%\LoliaNeko`）的 `userdata/frpc/` 下，主要包括：

- `bin/`：frpc 可执行文件
- `downloads/`：下载缓存
- `installed.json`：安装状态
- `settings.json`：下载镜像设置

## 项目状态

[![Codacy Badge](https://app.codacy.com/project/badge/Grade/4d343b8cfbec4da4ac31da906bd41b3f)](https://app.codacy.com/gh/Whirity404/LoliaNeko/dashboard?utm_source=gh&utm_medium=referral&utm_content=&utm_campaign=Badge_grade)
![Build](https://github.com/Whirity404/LoliaNeko/actions/workflows/release.yml/badge.svg)

![Alt](https://repobeats.axiom.co/api/embed/d79f920147af98c01983db8a421018c63bcddc57.svg "Repobeats analytics image")

## 许可证

本项目使用 `MIT` 许可证开源

## 感谢
[LoliaFRP-CLI](https://github.com/Lolia-FRP/lolia-frp)

[FRP](https://github.com/fatedier/frp)

[LoliaShizuku](https://github.com/Mxmilu666/LoliaShizuku)
