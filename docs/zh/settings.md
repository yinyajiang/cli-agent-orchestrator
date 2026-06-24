# 设置

CAO 将用户配置存储在 `~/.aws/cli-agent-orchestrator/settings.json` 中。该文件由设置服务管理,可通过 Web UI 的 Settings 页面或 REST API 进行编辑。

## Agent Profile 目录

CAO 通过扫描多个目录来发现 agent profile。在加载或列出 profile 时,目录按以下顺序扫描(第一个匹配项胜出):

1. **本地存储** —— `~/.aws/cli-agent-orchestrator/agent-store/`
2. **Provider 专属目录** —— 每个 provider 单独配置(参见下文默认值)
3. **额外的自定义目录** —— 用户添加的路径
4. **内置存储** —— 随 CAO 包打包

### 默认目录

| Key | Provider | 默认路径 |
|-----|----------|-------------|
| `kiro_cli` | Kiro CLI | `~/.kiro/agents` |
| `q_cli` | Q CLI | `~/.aws/amazonq/cli-agents` |
| `claude_code` | Claude Code | `~/.aws/cli-agent-orchestrator/agent-store` |
| `codex` | Codex | `~/.aws/cli-agent-orchestrator/agent-store` |
| `cao_installed` | CAO Installed | `~/.aws/cli-agent-orchestrator/agent-context` |

`cao_installed` 目录是 `cao install` 放置 agent profile 的位置。这样可以将已安装的 profile 与 `agent-store` 中手工编写的 profile 分开。

### 覆盖目录

可通过 REST API 或 Web UI 的 Settings 页面覆盖任意 provider 目录:

```bash
# Via REST API
curl -X POST http://localhost:9889/settings/agent-dirs \
  -H "Content-Type: application/json" \
  -d '{"kiro_cli": "/custom/path/to/agents"}'
```

或直接编辑 `settings.json`:

```json
{
  "agent_dirs": {
    "kiro_cli": "/custom/path/to/agents"
  }
}
```

只有指定的 provider 会被更新;其他 provider 保留其默认值。

### 额外目录

添加在所有 provider 中都会被扫描以发现 agent profile 的额外目录:

```json
{
  "extra_agent_dirs": [
    "/path/to/team-shared-agents",
    "/path/to/project-specific-agents"
  ]
}
```

## Skill 目录

CAO 按以下顺序扫描以发现 skill(通过 `load_skill` MCP 工具按需加载,第一个匹配项胜出):

1. **全局 skill 存储** —— `~/.aws/cli-agent-orchestrator/skills/`
2. **额外的自定义目录** —— 用户添加的路径(`extra_skill_dirs`)

这与 agent-profile 的解析逻辑对应:全局存储中的 skill 不会被后续额外目录中的同名 skill 遮蔽。`extra_skill_dirs` 允许你将项目的 skill 保留在项目仓库中(例如 `<repo>/.cao/skills`)并注册该目录,而无需将每个 skill 复制或符号链接到全局存储中。

```json
{
  "extra_skill_dirs": [
    "/path/to/team-shared-skills",
    "/path/to/project-specific-skills"
  ]
}
```

## settings.json 格式

```json
{
  "agent_dirs": {
    "kiro_cli": "~/.kiro/agents",
    "q_cli": "~/.aws/amazonq/cli-agents",
    "claude_code": "~/.aws/cli-agent-orchestrator/agent-store",
    "codex": "~/.aws/cli-agent-orchestrator/agent-store",
    "cao_installed": "~/.aws/cli-agent-orchestrator/agent-context"
  },
  "extra_agent_dirs": [],
  "extra_skill_dirs": []
}
```

## API 端点

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/settings/agent-dirs` | 获取当前 agent 目录(与默认值合并) |
| `POST` | `/settings/agent-dirs` | 更新 agent 目录 |
| `GET` | `/settings/skill-dirs` | 获取全局 skill 存储路径和额外 skill 目录 |
| `POST` | `/settings/skill-dirs` | 设置额外的自定义 skill 目录 |

完整 API 参考参见 [api.md](api.md)。

## 服务器网络设置

`cao-server` 默认是一个仅限本地的服务。host 头、CORS 和 WebSocket 客户端白名单出厂时都锁定到回环地址。有三个环境变量允许运维人员在反向代理后或容器内运行 CAO 时扩展各个白名单——参见 issue [#149](https://github.com/awslabs/cli-agent-orchestrator/issues/149) 和 [#151](https://github.com/awslabs/cli-agent-orchestrator/issues/151)。

这三个变量都接受一个逗号分隔的列表,并且会**扩展**(而非替换)内置的默认值,因此即使设置了环境变量,回环访问仍会保留:

| Env var | 扩展 | 使用场景 |
|---|---|---|
| `CAO_ALLOWED_HOSTS` | `ALLOWED_HOSTS`(`TrustedHostMiddleware` 使用的 Host 头白名单) | 在非 `localhost` / `127.0.0.1` 的主机名上用反向代理前置 `cao-server`。 |
| `CAO_CORS_ORIGINS` | `CORS_ORIGINS`(CORS 允许的浏览器来源) | 从非默认端口或其他来源(例如自定义 dashboard)提供 web UI。 |
| `CAO_WS_ALLOWED_CLIENTS` | `WS_ALLOWED_CLIENTS`(允许接入 PTY WebSocket 的客户端 IP) | 在 Docker 中运行 `cao-server`,宿主机浏览器通过网桥 IP(例如 `172.17.0.1`)访问。 |

示例 —— 在一个接受来自 Docker 网桥的 WebSocket 接入的容器中运行 `cao-server`:

```bash
CAO_ALLOWED_HOSTS=cao.local \
CAO_CORS_ORIGINS=http://cao.local:8080 \
CAO_WS_ALLOWED_CLIENTS=172.17.0.1 \
  uv tool run cao-server --host 0.0.0.0
```

> **Security note:** WebSocket PTY 端点是无身份验证的。只将你确实信任的客户端 IP 添加到 `CAO_WS_ALLOWED_CLIENTS` 中——任何能够通过这些 IP 之一访问到该监听器的人,都将获得对正在运行的 agent 终端的完整 PTY 访问权限。
