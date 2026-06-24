# 控制面

CAO 提供了多种方式来驱动会话并观察它们的行为。它们之间并非二选一的关系 —— 而是在两个维度上占据不同位置:由谁主导,以及流量朝哪个方向走。

本指南解释每个接口的用途、使用时机,以及它们如何组合在一起。

## 四个接口一览

| 接口 | 方向 | 谁调用它 | 传输方式 | 典型用途 |
|---|---|---|---|---|
| **Web UI** | 入站(外部 → CAO) | 浏览器中的人 | HTTP + WebSocket | 从浏览器进行交互式管理 |
| **`cao session` CLI + [`cao-session-management`](../../skills/cao-session-management/SKILL.md) skill** | 入站 | 终端中的人,或者能运行 shell 命令的外部 agent | Shell → HTTP | 脚本、CI 流水线、无头任务、不能使用 MCP 的 agent |
| **`cao-ops-mcp` 服务器** | 入站 | 任何支持 MCP 的外部 agent | MCP (stdio) → HTTP | 由主 agent 在自己的对话循环内部管理 CAO |
| **插件**(例如 `cao-discord`)| **出站**(CAO → 外部) | `cao-server` 自身,fire-and-forget | Python 钩子 → 插件自选的方式(webhook、日志、指标)| 把事件转发到聊天应用、可观测性、审计日志 |

此外,会话内的 MCP 服务器(`cao-mcp-server`)负责 CAO 会话*内部*的 agent 间编排。这与本文档正交 —— 关于 `handoff` / `assign` / `send_message`,请参见 README 中的 [MCP Server Tools and Orchestration Modes](../../README.md#mcp-server-tools-and-orchestration-modes)。

## 入站 vs 出站

首先要内化的概念是:**Web UI、`cao session` 和 `cao-ops-mcp` 都是入站的** —— 它们是告诉 CAO 该做什么的方式。**插件是出站的** —— 它们是 CAO 告诉外部世界自己在做什么的方式。

所以"我该用插件还是 `cao-ops-mcp`?"并不是正确的问题。正确的问题是:

- 谁在发起?→ 入站接口。
- 是否有东西需要知道 CAO 做了某件事?→ 插件。

一个双向桥接(例如一个 Telegram 机器人,既让 Telegram 用户驱动 CAO,又把 CAO 事件回流到频道)由两个组件构成:一个负责出站的插件,以及一条负责命令的入站调用路径。

## 入站接口

所有三个入站接口最终都打到同一个位于 `localhost:9889` 的 HTTP API。它们的区别仅在于调用方*如何*到达那里。

### Web UI

随 `cao-server` 附带的、基于浏览器的看板。参见 README 中的 [Web UI](../../README.md#web-ui)。

- **优势:**交互式、可视化,对人类运维者零配置。
- **劣势:**仅限人类 —— 不支持脚本,也不支持 agent 访问。

### `cao session` CLI 与 `cao-session-management` skill

一组 `cao session <verb>` 命令(`list`、`status`、`send`,加上 `cao launch` / `cao shutdown`),被封装成一个 [skill](../../skills/cao-session-management/SKILL.md),这样任何遵循 SKILL.md 格式的 agent 都可以通过运行 shell 命令来驱动 CAO。

- **优势:**通用 —— 可从 bash、Python、`subprocess`、任何 agent 框架、任何能运行命令的外部工具使用。对调用方零协议要求。
- **使用时机:**
  - 脚本、CI 流水线、无头任务。
  - 不支持 MCP 的外部 AI 助手 —— 例如 [OpenClaw](https://github.com/openclaw/openclaw) 或 [Hermes Agent](https://github.com/NousResearch/hermes-agent)。任何支持 shell 可调用 skill 的助手都应可行。
  - 需要快速一次性执行,而启动一个 MCP 客户端显得太重的场景。

命令参考请参见 README 中的 [Session Management](../../README.md#session-management)。

### `cao-ops-mcp` 服务器

一个 MCP 服务器,以结构化工具调用的形式暴露同一套管理操作。把它加到主 agent 的 MCP 配置中,该 agent 就可以像调用有类型的工具一样调用 `launch_session`、`list_sessions`、`install_profile` 等。

- **优势:**用结构化工具调用替代 shell 解析。有类型的参数、有类型的结果,错误以工具调用错误的形式呈现。
- **使用时机:**
  - 一个已经在使用 MCP 的主 agent(Claude Code、Claude Desktop 等)应优先选择此项,而非 shell。
  - agent 能从工具级可发现性中受益的多步骤工作流。
- **不宜使用的场景:**如果你的调用方不能使用 MCP,或者你在写一个 shell 脚本 —— 请改用 `cao session`。

设置方式和工具目录请参见 README 中的 [CAO Ops MCP Server](../../README.md#cao-ops-mcp-server)。

### 在 `cao session` 与 `cao-ops-mcp` 之间选择

| 如果你的调用方是… | 推荐 |
|---|---|
| 浏览器中的人 | Web UI |
| 一个 shell 脚本、cron 任务、CI 步骤 | `cao session` |
| 支持 MCP 的 agent(Claude Code、Claude Desktop 等)| `cao-ops-mcp` |
| 只能运行 shell 命令的 AI 助手 | 通过 skill 使用 `cao session` |
| 一个轮询 CAO 的自定义 Python 服务 | 直接调用位于 `localhost:9889` 的 HTTP API(参见 [docs/api.md](api.md))|

它们在功能上是等价的 —— 二者最终都调用同样的 HTTP 端点。选择纯粹是出于易用性考虑。

## 出站接口:插件

插件是在启动时加载进 `cao-server` 的 Python 包。它们通过 `@hook("<event_type>")` 订阅生命周期与消息事件并作出响应 —— 典型方式是将事件转发到别处。

- **优势:**零轮询。事件在发生的那一刻就被派发,带有类型化的载荷并能直接访问 DB。
- **约束:**当前的插件**仅作为观察者**。它们无法阻塞、修改或拒绝 CAO 操作。参见 `docs/plugins.md` 以及 README 中的 Plugins 小节。

### 为什么用插件而不是轮询

你可以通过轮询 `/terminals/{id}/inbox/messages` 或 tail 日志来搭建一个 Discord 桥接。插件的存在正是为了绕开这些:

1. 事件从 `cao-server` 内部派发,因此没有轮询延迟,也没有浪费的调用。
2. 事件是 pydantic 模型,而不是需要解析的 JSON blob。
3. 插件在进程内运行,可通过 `get_terminal_metadata()` 直接查询 DB —— 无需 HTTP 往返。
4. 钩子抛出的异常会被捕获并记录,因此一个出问题的插件不会拖垮服务器。
5. 生命周期绑定到 `cao-server`,因此没有额外的守护进程需要照看。

### 插件的常见用途

- 将 agent 间消息转发到聊天应用(Discord、Slack、Telegram、Teams)。
- 对会话和终端生命周期进行审计日志。
- 指标导出(Prometheus、CloudWatch)。
- 针对特定事件告警(错误、长时间运行的会话)。

### 编写插件

- **参考实现:**[`examples/plugins/cao-discord/`](../../examples/plugins/cao-discord/) —— 约 75 行,把 `post_send_message` 事件转发到 Discord webhook。该模式可直接复用于 Slack、Telegram 或任何 webhook 式集成 —— 只需替换 URL 格式和 JSON 载荷形状。
- **引导式脚手架:**[`cao-plugin`](../../skills/cao-plugin/SKILL.md) skill。把任何 skill 感知的 agent 指向它,并要求"create a CAO plugin for Telegram";它会脚手架出包结构、入口点和钩子注册,并展示哪些事件可用。
- **安装与配置:**参见 [docs/plugins.md](plugins.md)。

## 组合起来看

一个实际例子:"我想要一个 Telegram 频道,团队成员可以在其中输入 `/cao launch …` 并看到 agent 回复。"

这由三部分组成:

1. **出站:**一个 `cao-telegram` 插件,订阅 `post_send_message`(可能还有会话生命周期事件)并把它们发到频道里。
2. **入站:**一个 Telegram 机器人进程,监听聊天命令并把它们翻译成对 `cao-ops-mcp` 或 `cao session` 的调用(两者皆可)。
3. **胶水:**你喜欢用的任何映射层,在 Telegram 用户 ID 与 CAO 会话名之间做对应。

每个组件都很小。接口的划分让每一个都专注于单一方向。

## 延伸阅读

- README 中的 [Session Management](../../README.md#session-management) —— `cao session` / `cao launch` / `cao shutdown` 的命令参考。
- README 中的 [CAO Ops MCP Server](../../README.md#cao-ops-mcp-server) —— `cao-ops-mcp` 的设置方式和工具目录。
- [docs/plugins.md](plugins.md) —— 插件安装、事件目录、排错。
- [docs/api.md](api.md) —— 每个入站接口最终都调用的底层 HTTP API。
- [skills/cao-session-management/SKILL.md](../../skills/cao-session-management/SKILL.md) —— 教一个 agent 通过 shell 驱动 CAO。
- [skills/cao-plugin/SKILL.md](../../skills/cao-plugin/SKILL.md) —— 脚手架搭建一个新插件。
