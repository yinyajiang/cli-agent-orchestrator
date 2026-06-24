# Web UI

CAO 内置了一个 Web 仪表盘,用于在浏览器中管理 agents、terminals 和 flows。

![CAO Web UI](https://github.com/user-attachments/assets/e7db9261-62b1-4422-b9f5-6fe5f65bdea4)

## 何时需要 Node.js

预构建的 Web UI 已打包进 CAO 的 wheel(位于 `src/cli_agent_orchestrator/web_ui/`),因此普通的 `uv tool install` 就包含了你所需的一切。**使用 Web UI 不需要 Node.js 或 `npm install`。**

只有在以下情况才需要 Node.js 18+:

- 运行前端开发服务器以进行热重载开发(下文的方案 A),或
- 从源码重新构建打包产物。

仅当符合上述任一情况时才安装 Node:

```bash
# macOS (Homebrew)
brew install node

# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs

# Amazon Linux 2023 / Fedora
sudo dnf install nodejs20

# 验证
node --version   # 18 或更高
```

## 启动 Web UI

### 方案 A:开发模式(热重载,需两个终端)

```bash
# 终端 1 —— 启动后端服务器
cao-server

# 终端 2 —— 启动前端开发服务器
cd web/
npm install        # 仅首次需要
npm run dev        # 在 http://localhost:5173 启动
```

在浏览器中打开 http://localhost:5173。

### 方案 B:生产模式(单服务器,无需 Vite)

已构建的 Web UI 打包在 CAO 的 wheel 中,因此普通的 `uv tool install` 就包含了你所需的一切。只需启动服务器:

```bash
cao-server
```

在浏览器中打开 http://localhost:9889。

如需从源码重新构建前端:

```bash
cd web/
npm install && npm run build   # 输出到 src/cli_agent_orchestrator/web_ui/
uv tool install . --reinstall
```

> **自定义 host/port:** `cao-server --host 0.0.0.0 --port 9889` 会把服务器暴露给网络 —— 在这样做之前,请先阅读根目录 README 中的 [Security](../../README.md#security)。

## 远程机器访问

如果你在远程主机上运行 CAO(例如一台开发台式机),可以通过 SSH 转发端口:

```bash
# 开发模式(同时代理前端和后端)
ssh -L 5173:localhost:5173 -L 9889:localhost:9889 your-remote-host

# 生产模式(后端直接提供 UI)
ssh -L 9889:localhost:9889 your-remote-host
```

然后在本地浏览器中打开相同的 URL(localhost:5173 或 localhost:9889)。

## 功能

在浏览器中即可管理会话、生成 agents、创建定时 flows、配置 agent 目录,并与活动的终端交互。还包括实时状态徽章、用于 agent 间消息传递的 inbox、输出查看器,以及 provider 自动检测。

## 相关

- [web/README.md](../../web/README.md) —— 前端架构与组件详情
- [docs/settings.md](settings.md) —— agent 目录配置
- [docs/control-planes.md](control-planes.md) —— Web UI 与 `cao session`、`cao-ops-mcp` 之间的关系
