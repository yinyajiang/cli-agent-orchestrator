# 插件

CAO 支持对服务器端事件作出响应的插件 —— 包括会话和终端的生命周期变化,以及 agent 之间的消息传递。插件运行在 `cao-server` 进程内,当这些事件之一发生时会得到通知。

当前典型用途:

- 将 agent 之间的消息转发到外部聊天(Discord、Slack)
- 审计日志
- 可观测性与指标导出

**重要说明:**当前的插件**仅作为观察者**。它们在对应操作*已经发生之后*才收到事件,无法阻塞、修改或拒绝 CAO 操作。计划中的扩展请参见 [Future improvements](#future-improvements)。

可直接试用的参考插件见 [`examples/plugins/`](../../examples/plugins)。

## 快速上手:你的第一个插件事件

本演练带你从全新克隆开始,端到端看到插件事件触发。它使用自带的 Discord 示例插件,但步骤适用于任何插件。

1. **安装 CAO 及其前置依赖** —— 参见 [README.md § Installation](../../README.md#installation)(uv、tmux 3.3+、Python 3.10+,然后对开发检出执行 `uv sync`)。
2. **安装 Discord 插件**到同一环境中:
   ```bash
   uv pip install -e examples/plugins/cao-discord
   ```
3. **配置插件** —— 在仓库根目录(你将运行 `cao-server` 的地方)创建一个 `.env` 文件:
   ```dotenv
   CAO_DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/<id>/<token>
   ```
4. **启动服务器** —— 插件在启动时自动被发现:
   ```bash
   cao-server
   ```
   确认在服务器日志中看到 `Loaded CAO plugin: discord`。
5. **安装 agent 并启动会话** —— 按 [README.md § Quick Start](../../README.md#quick-start) 的第 1 步和第 3 步安装 agent profile 并启动 supervisor 终端。
6. **在 supervisor 终端触发一次 handoff 或 assign** —— 在 Discord 频道中观察被转发的 agent 间消息。

更详细的安装选项、配置和排错,请继续阅读下文。

## 安装插件

插件是通过 `cao.plugins` 入口点分发的标准 Python 包。安装一个插件意味着:把该包安装到 `cao-server` 运行所在的同一 Python 环境、配置它、然后重启服务器。本节通篇使用 [`examples/plugins/cao-discord`](../../examples/plugins/cao-discord) 中的 Discord 示例插件。

### 1. 安装插件包

把插件安装到提供 `cao-server` 的同一环境中。对于已发布的插件:

```bash
uv pip install <plugin-package>
```

对于本地的 Discord 示例:

```bash
uv pip install -e examples/plugins/cao-discord
```

插件在服务器启动时通过 `cao.plugins` Python 入口点组被发现 —— 没有单独的"注册"步骤。

### 2. 配置插件

每个插件拥有自己的配置。大多数插件读取环境变量,并且许多支持从你启动 `cao-server` 的目录(或其父目录 —— `python-dotenv` 会从 CWD 向上查找)加载 `.env` 文件。

例如,Discord 插件需要一个 webhook URL:

```bash
# .env
CAO_DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/<id>/<token>
```

请查阅插件自身的 README 了解其配置键。

### 3. 重启 `cao-server`

插件仅在服务器启动时加载一次。安装或重新配置插件后,重启 `cao-server` 才能让改动生效。当前没有热重载机制。

### 4. 验证插件已加载

`cao-server` 启动时,每个插件会打印一行 setup 日志。确认你安装的插件出现在那里,并留意是否有 `WARNING` 条目 —— 配置错误的插件会被跳过并发出警告,而不会导致服务器崩溃。

## 排错

**插件已安装但没有反应。**
最常见的原因是,插件被安装到了与 `cao-server` 不同的 Python 环境。检查 `which cao-server`,并把插件安装到那个相同的环境中。

**插件在启动时打印 `WARNING`。**
通常是缺失或格式错误的配置值(例如未设置的环境变量)。CAO 会跳过该插件并继续运行。修复配置后重启即可。

**事件似乎没有触发。**
确认插件订阅了哪些事件(参见 [Events](#events)),以及你正在执行的操作确实会发出其中某个事件。例如,`post_send_message` 在向 agent 收件箱投递消息时触发 —— 而不是在 agent 输出或状态变化时。

**修改配置后插件似乎未生效。**
插件仅在启动时加载。任何安装或配置变更后都要重启 `cao-server`。

## 事件

插件安装后,可以对以下事件作出响应。所有事件都在关联操作成功完成*之后*派发。

### `post_send_message`

在一条消息被投递到 agent 收件箱之后触发。三种编排模式 —— `send_message`、`handoff` 和 `assign` —— 都会发出此事件。多步骤编排(例如 `assign`)在其生命周期内可能发出多个事件。

| 字段                 | 描述                                                       |
|----------------------|------------------------------------------------------------|
| `sender`             | 发送方的终端 ID                                            |
| `receiver`           | 接收方的终端 ID                                            |
| `message`            | 投递的消息文本                                             |
| `orchestration_type` | 取值为 `send_message`、`handoff`、`assign` 之一            |
| `session_id`         | 接收方所属的会话                                           |
| `timestamp`          | 事件的 UTC 时间戳                                          |

示例用途:把每条 agent 间消息转发到 Discord 或 Slack 频道。

### `post_create_session`

在创建新会话之后触发。

| 字段           | 描述                       |
|----------------|----------------------------|
| `session_name` | 人类可读的会话名           |
| `session_id`   | 唯一会话标识符             |
| `timestamp`    | 事件的 UTC 时间戳          |

示例用途:向外部系统发布"会话已启动"通知。

### `post_kill_session`

在关闭一个会话及其所有终端之后触发。

| 字段           | 描述                       |
|----------------|----------------------------|
| `session_name` | 人类可读的会话名           |
| `session_id`   | 唯一会话标识符             |
| `timestamp`    | 事件的 UTC 时间戳          |

示例用途:清理与该会话相关的外部记录,或发布完成总结。

### `post_create_terminal`

在会话内创建新终端之后触发。

| 字段          | 描述                                          |
|---------------|-----------------------------------------------|
| `terminal_id` | 唯一终端标识符                                |
| `agent_name`  | 在该终端中运行的 agent profile 名称           |
| `provider`    | CLI provider(例如 `claude_code`、`kiro_cli`) |
| `session_id`  | 该终端所属的会话                              |
| `timestamp`   | 事件的 UTC 时间戳                             |

示例用途:维护一个活跃 agent 的外部清单。

### `post_kill_terminal`

在关闭一个终端之后触发。

| 字段          | 描述                                  |
|---------------|---------------------------------------|
| `terminal_id` | 唯一终端标识符                        |
| `agent_name`  | 之前运行的 agent profile 名称         |
| `session_id`  | 该终端所属的会话                      |
| `timestamp`   | 事件的 UTC 时间戳                     |

示例用途:从外部清单或看板中移除该终端。

## 编写插件

本文档聚焦于插件的安装与使用。完整的插件编写指南 —— 脚手架搭建一个插件包、继承 `CaoPlugin`、接入 `@hook` 方法以及测试 —— 请参见 [`cao-plugin` skill](../../skills/cao-plugin/SKILL.md)。

## 后续改进

以下项目**当前尚不可用** —— 它们描述的是插件系统预期的发展方向。

- **`pre_*` 事件** —— 在操作发生*之前*进行观察(例如 `pre_send_message`、`pre_create_terminal`),让插件能看到意图,而不仅仅是结果。
- **事件拒绝 / 否决** —— 允许插件通过 `pre_*` 返回值拒绝一个进行中的操作。
- **事件转换** —— 允许插件在中途改写事件载荷(例如在消息投递前对内容进行脱敏)。
- **插件管理 CLI** —— `cao plugin list / info / enable / disable / reload`,无需触碰 `pip` 或手动重启服务器即可管理已安装的插件。
- **热重载** —— 无需重启 `cao-server` 即可应用插件的安装、升级或配置变更。
- **改进的发现与安装体验** —— 一个策展过的插件索引、一个 `cao plugin install <name>` 包装器,或一个不要求共享服务器 Python 环境的专用插件目录。
- **一等公民级别的插件配置** —— 由 CAO 提供的配置通道,这样插件就不必各自实现环境变量 / `.env` 加载。
- **更丰富的事件目录** —— 增加诸如 provider 状态变化、流程步骤转换、收件箱读取等事件。
