# herdr 后端

CAO 的默认后端是 [tmux](tmux.md)。对于 agentic 工作负载,CAO 还支持 [herdr](https://herdr.dev/)——一个专为 AI 编码 agent 设计的终端原生 agent 运行时和多路复用器。

关键区别在于:tmux 没有"agent 状态"的概念,因此 CAO 必须轮询终端输出并匹配正则表达式来检测 agent 何时进入空闲。herdr 暴露一个 Unix socket API,会发出实时状态事件(`working`、`idle`、`done`、`blocked`)。这彻底消除了轮询,并实现了即时的 inbox 投递。

## tmux 与 herdr 的对比

| | tmux | herdr |
|---|---|---|
| 状态检测 | 轮询 `capture-pane` 输出 + 正则匹配 | 原生 socket 事件(`idle`、`done`、`blocked`) |
| Inbox 投递 | Watchdog 每 5s 轮询,在匹配到空闲模式时投递 | 事件驱动:状态变化时立即投递 |
| 会话身份 | 从面板内容推断 | 按面板原生跟踪 |
| 接入 agent | `tmux attach -t <session>` | `herdr attach` 或 herdr TUI |
| 成熟度 | 稳定、经过充分测试的默认选项 | 实验性 |

如果你想要更低延迟的 agent 间消息传递和原生的 agent 生命周期跟踪,请选择 herdr。如果你想要稳定、久经考验的默认选项,请选择 tmux。

## 前置条件

1. 已安装 **herdr** 且在 `$PATH` 中可用。安装说明参见 [herdr.dev](https://herdr.dev/)。
2. 为配置的会话准备一个 **herdr server**。如果会话 socket 不存在,CAO 会自动启动它,因此预先启动是可选的。要自行启动(或接入):

```bash
herdr                        # default session name
herdr --session cao          # explicit session name (recommended)
```

## 配置

在 `~/.aws/cli-agent-orchestrator/config.json` 中设置 `terminal_backend`:

```json
{
  "terminal_backend": "herdr"
}
```

可选地指定 herdr 会话名称(默认为 `"cao"`):

```json
{
  "terminal_backend": "herdr",
  "herdr_session": "my-session"
}
```

> **Note:** 该配置写在 `config.json` 中,而不是 `settings.json`。关于这两个文件的区别,参见 [settings.md](settings.md)。

## 启动

在 `config.json` 中设置 `terminal_backend` 后,启动服务器的方式与 tmux 相同——CAO 会检测后端并自动连接 herdr:

```bash
cao-server
```

要在不编辑 `config.json` 的情况下选择 herdr,传入 `--terminal`:

```bash
cao-server --terminal herdr
```

`--terminal` 参数(`tmux` 或 `herdr`)会覆盖 `config.json` 中该次运行的 `terminal_backend`。如果设置了 `herdr_session` 名称,仍会从 `config.json` 中读取。

## 查看与接入

```bash
# List active CAO sessions
cao session list

# Attach to the herdr TUI (shows all workspaces and tabs)
herdr --session cao

# Attach to a specific CAO session
cao session attach <session-name>
```

## 工作原理

CAO 将其概念映射到 herdr 的原语上:

| CAO 概念 | herdr 原语 |
|---|---|
| Session(例如 `cao-my-task`) | Workspace(以会话名称标记) |
| Terminal / window(例如 `conductor-a1b2`) | Workspace 内的 Tab(以窗口名称标记) |

### 事件驱动的 inbox 投递

`HerdrInboxService` 在启动时连接到 herdr Unix socket,并为每个受管理的面板订阅 `pane.agent_status_changed` 事件。当面板转换为 `idle` 或 `done` 时,待处理的 inbox 消息会立即投递。

### 启动与重连行为

在服务器启动时(或 socket 断开后的重连时):

1. **启动清理** —— 将所有 DB 终端记录与活动的 herdr tab 进行交叉核对。移除由先前异常退出的服务器运行所留下的幽灵记录。
2. **重连协调** —— 从内存映射中清理过期的面板订阅,仅重新订阅仍然存活的面板。
3. **生命周期事件** —— 订阅 `pane.closed` 和 `workspace.closed` 事件,以便在 agent 退出或会话结束时进行实时清理。

socket 连接在断开时使用指数退避(1s 到 30s)。

## 切回 tmux

从 `config.json` 中移除 `terminal_backend`,或显式设置它:

```json
{
  "terminal_backend": "tmux"
}
```

重启 CAO 服务器。现有的 herdr 会话不受影响(它们仍在 herdr 中运行)。新会话将在 tmux 中创建。

## 故障排查

### 服务器重启后 `cao session list` 没有显示会话

来自先前运行的幽灵 DB 记录已被清理。这是预期行为。重启服务器并检查日志中的:

```
Startup DB cleanup: removed N ghost terminal(s)
```

如果会话确实在 herdr 中运行,它们会在下次 `cao launch` 时被重新发现。

### 会话在 herdr 中可见但在 CAO 中不可见

CAO 服务器可能连接到了错误的 herdr 会话。请验证 `config.json` 中的 `herdr_session` 与 herdr 正在运行的会话一致:

```bash
# Check which session herdr is using
herdr workspace list                        # default session
herdr --session cao workspace list          # named session
```

### CAO 日志中出现 socket 连接错误

CAO 服务器启动前必须先运行 herdr。如果看到 socket 错误:

1. 确认 herdr 正在运行:`herdr --session cao workspace list`
2. 如果未运行,启动它:`herdr --session cao`
3. 重启 CAO 服务器:`cao-server`

默认的 socket 路径由会话名称派生。如果你使用了非默认的 `herdr_session`,请确保启动 herdr 时使用了匹配的 `--session` 参数。
