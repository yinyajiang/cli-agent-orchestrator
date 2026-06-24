# Hermes Provider

CAO 可以将 Hermes Agent 作为内置 provider 启动。默认情况下它启动主 `hermes` 命令。CAO agent profile 可以选择性地设置 `hermesProfile`,通过特定的 Hermes profile 包装器来路由该 agent。

## 前置条件

- 已安装并完成 Hermes Agent 的认证。
- Hermes Agent 在 `PATH` 上。
- 若要从 Hermes 内部进行 CAO 多 agent 编排,请在所选的 Hermes profile 中配置 CAO MCP 服务器。CAO 不会改写 Hermes 的 `config.yaml`,也不会自动注入 `mcpServers`。
- 可选:如果你希望该 CAO profile 使用非默认的 Hermes profile,需要有一个 Hermes profile 包装器在 `PATH` 上:

```bash
hermes profile alias test-worker
which test-worker
```

## CAO Profile

创建一个选择 Hermes provider 的 CAO agent profile:

```yaml
---
name: hermes_default
description: Developer backed by the default Hermes profile
provider: hermes
role: developer
---

You are a helpful developer agent.
```

要使用特定的 Hermes profile 包装器,添加 `hermesProfile`:

```yaml
---
name: hermes_developer
description: Developer backed by a Hermes worker profile
provider: hermes
hermesProfile: test-worker
role: developer
---

You are a helpful developer agent.
```

`hermesProfile` 是 CAO 启动时用来替代 `hermes` 的 shell 命令。在上面的例子中,它就是通过 `hermes profile alias test-worker` 创建的 profile alias。

请将此字段与 `codexProfile` 区分开。Codex profile 命名的是 `~/.codex/config.toml` 中的 `[profiles.<name>]` 块,并以 `codex --profile <name>` 形式传入。Hermes profile alias 是可执行的包装器命令,因此 CAO 会以 `<alias> chat ...` 的形式直接启动该 alias。使用 Hermes 专用的字段可以让这种"命令包装器"行为保持显式。

## 启动

```bash
cao launch --agents hermes_developer --auto-approve
cao launch --agents hermes_developer --yolo
```

不带 `hermesProfile` 时,CAO 以如下方式启动 Hermes:

```bash
hermes chat --yolo --accept-hooks --source cao
```

带 `hermesProfile: test-worker` 时,CAO 以如下方式启动 Hermes:

```bash
test-worker chat --yolo --accept-hooks --source cao
```

如果 CAO agent profile 设置了 `model`,CAO 会追加 `--model <value>`。

## MCP 配置

Hermes 从所选 Hermes profile 的配置中读取 MCP 服务器。CAO 会用正确的 `CAO_TERMINAL_ID` 环境变量启动 Hermes,但不会修改 Hermes profile 文件,也不会创建临时 overlay 配置。

要让一个 Hermes supervisor 能够调用 CAO 编排工具,例如 `assign`、`handoff` 和 `send_message`,请把 `cao-mcp-server` 添加到 `hermesProfile` 所使用的 Hermes profile 中:

```yaml
mcp_servers:
  cao-mcp-server:
    enabled: true
    command: cao-mcp-server
    env:
      CAO_TERMINAL_ID: ${CAO_TERMINAL_ID}
```

如果 `cao-mcp-server` 不在 Hermes 的 `PATH` 上,请使用绝对路径:

```yaml
mcp_servers:
  cao-mcp-server:
    enabled: true
    command: /absolute/path/to/cao-mcp-server
    env:
      CAO_TERMINAL_ID: ${CAO_TERMINAL_ID}
```

请在 `hermesProfile` 选中的那个 Hermes profile 中完成此操作(例如使用 `test-worker` alias 时,对应 `~/.hermes/profiles/test-worker/config.yaml`)。必须配置 `CAO_TERMINAL_ID` 环境变量条目,这样每个由 Hermes 启动的 MCP 服务器在调用 `send_message`、`assign` 或 `handoff` 时,才能识别自己所属的 CAO 终端。

## 提示符检测

Hermes 主题可以自定义可见的提示符、提示符符号以及 assistant 分隔符。因此 provider 避免硬编码具体的提示符字符串。默认设置优先采用稳定的 status-bar 信号,而非提示符符号:

- idle:status-bar 的 idle 计时器 `⏲ <duration>` 在连续轮询中保持不变
- processing:提示符占位/状态文本,例如 `msg=interrupt`、`/queue`、`/bg`、`Ctrl+C cancel`、`musing...`、`Initializing agent`,或活动的计时器提示
- 响应提取:存在 assistant 分隔符时使用它;否则取最后一条用户消息之后、最后一个非状态内容块

如果你的 Hermes profile 使用了差异很大的主题,可以覆盖这些匹配模式:

```bash
export CAO_HERMES_IDLE_PROMPT_REGEX='^my-worker > $'
export CAO_HERMES_PROCESSING_REGEX='working|thinking|interrupt'
export CAO_HERMES_ASSISTANT_HEADER_REGEX='^--- assistant ---$'
export CAO_HERMES_USER_PREFIX_REGEX='^User: '
```

## 交互式提示的回答

Hermes 目前是唯一一个会报告 `WAITING_USER_ANSWER`、并针对结构化审批提示和 clarify 选择器使用基于按键导航的 in-tree provider。Supervisor 可以用 `answer_user_prompt(terminal_id, answer)` 来回答这些提示。

对于 clarify 选择器,数字回答会通过 `Down`/`Enter` 按键选中对应选项。自由文本回答会导航到 `Other` 选项并提交文本输入。其他 provider 可能在其终端输出中展示提示,但目前并不提供同样的结构化 `WAITING_USER_ANSWER` 行为。当 CAO 把该行为加入另一个 provider 时,本文档应补充该 provider 的提示契约。

任何能访问 `cao-mcp-server` 并持有目标终端 ID 的 agent,都可以回答一个处于等待状态的 Hermes 提示。CAO 目前不对 `answer_user_prompt` 强制 parent/supervisor 关系,因此 profile 作者应仅向受信任、有权协调该会话的 agent 暴露 MCP 服务器。

## 工具限制

Hermes 目前没有提供 CAO 原生的硬拒绝开关,等价于 Claude Code 的 `--disallowedTools` 或 Copilot 的 `--deny-tool`。CAO 以 `--yolo` 模式启动配置的 Hermes 命令,以支持无人值守编排。当需要更受限的 worker 时,请在所选的 Hermes profile 内部对工具进行限制。

## 备注

- Hermes 没有 CAO 原生的工具限制硬拒绝开关。请将严格的工具策略保留在所选的 Hermes profile 中。
- 运行时 skills 和 MCP 服务器必须在所选的 Hermes profile 中配置。CAO 有意避免修改 Hermes profile 配置,以便 Hermes 的会话历史始终附着在用户所选的 profile 上。
