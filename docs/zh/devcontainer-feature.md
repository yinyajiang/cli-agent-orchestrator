# Devcontainer Feature(CAO)

本文档介绍如何使用官方的 CAO devcontainer feature、如何在本地验证它,以及应该如何发布。

## 目标

只需一个 feature 块,即可在 devcontainer 中安装 CLI Agent Orchestrator,可选择性地构建 Web UI 资产,以及可选择性地自动启动 `cao-server`。

## 选项

该 feature 支持以下选项:

- `version`(字符串,默认:`latest`)—— 要检出的 git ref(`latest`、tag 或 commit SHA)
- `webui`(布尔,默认:`false`)—— 安装期间是否构建 web 资产
- `port`(字符串,默认:`9889`)—— entrypoint 自动启动时使用的服务器端口
- `autostart`(布尔,默认:`false`)—— 容器启动时是否运行 `cao-server`

## 用法

### 1) 使用已发布的 feature(推荐)

发布到 GHCR 之后使用:

```json
{
  "features": {
    "ghcr.io/awslabs/cli-agent-orchestrator/cao:2": {
      "version": "latest",
      "webui": false,
      "port": "9889",
      "autostart": false
    }
  }
}
```

### 2) 使用本地 feature(用于开发和测试)

直接从仓库检出来使用:

```json
{
  "features": {
    "./.devcontainer/features/cao": {
      "version": "latest",
      "webui": false,
      "port": "9889",
      "autostart": false
    }
  }
}
```

如果启用 `webui: true`,请确保容器内有 `npm`(例如通过添加 `ghcr.io/devcontainers/features/node:1`)。

## 验证

### 必做的冒烟检查

在目标容器环境中运行:

```bash
sudo VERSION=latest WEBUI=false AUTOSTART=false bash .devcontainer/features/cao/install.sh
cao --help
cao-server --help
```

### 可选的完整检查

```bash
sudo VERSION=latest WEBUI=true AUTOSTART=false bash .devcontainer/features/cao/install.sh
```

然后验证所选版本下存在以下某一种 web 产物布局:

- `/usr/local/share/cao/repo/web/dist/index.html`(较旧的布局)
- `/usr/local/share/cao/repo/src/cli_agent_orchestrator/web_ui/index.html`(当前布局)

## 说明

- 默认的仓库来源是官方上游:`https://github.com/awslabs/cli-agent-orchestrator.git`
- `REPO_URL` 仅可出于测试 / 自定义 fork 的目的被覆盖
- Feature 清单依赖 `ghcr.io/devcontainers/features/python:1` 以保证 `pip` 可用

## 发布计划

1. 在冒烟检查通过之前,feature 保持为 draft PR 状态。
2. 评审通过后合并进 `main`。
3. 构建 feature 产物并发布到 `ghcr.io/awslabs/cli-agent-orchestrator/cao`,带有主版本 tag `:2` 以及不可变的版本 tag。
4. 更新仓库文档 / 示例,改用已发布的 registry 引用。
5. 用发布出来的 feature 块创建一个全新的 devcontainer 进行发布后验证。
6. 在 release notes 中公布可用性,并附带回滚说明(固定到上一个已知良好的 feature tag)。
