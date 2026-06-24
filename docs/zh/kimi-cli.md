# Kimi CLI Provider

## 概述

Kimi CLI provider 让 CAO 能够与 [Kimi Code CLI](https://kimi.com/code)——Moonshot AI 的编码 agent CLI 工具——协同工作。Kimi CLI 基于 prompt_toolkit 以交互式 TUI 运行。

## 前置条件

- **Kimi CLI**:通过 `brew install kimi-cli` 或 `uv tool install kimi-cli` 安装
- **认证**:运行 `kimi login`(基于 OAuth)
- **tmux 3.3+**

验证安装:

```bash
kimi --version
```

## 快速开始

```bash
# 认证
kimi login

# 使用 CAO 启动
cao launch --agents code_supervisor --provider kimi_cli
```

## 状态检测

该 provider 通过分析 tmux 终端输出来检测 Kimi CLI 的状态:

| 状态 | 模式 | 描述 |
|------|------|------|
| **IDLE** | 底部出现 `💫` 或 `✨`(可选地带有 `username@dirname` 前缀) | 提示符可见,可接受输入 |
| **PROCESSING** | 底部没有提示符 | 正在流式输出响应 |
| **COMPLETED** | 底部有提示符 + 锁存标志(检测到用户输入) | 任务完成 |
| **ERROR** | 出现 `Error:`、`APIError:`、`ConnectionError:` 等模式 | 检测到错误 |

### 提示符符号

- **💫**(dizzy):已启用思考模式(默认行为)
- **✨**(sparkle):已禁用思考模式(使用 `--no-thinking` flag)

该 provider 使用模式 `(?:\w+@[\w.-]+)?[✨💫]` 同时匹配这两个符号。`username@dirname` 前缀是可选的,以同时兼容 v1.20.0+(裸 emoji)及更早版本。

## 消息提取

从终端输出中提取响应(支持两种格式):

**v1.20.0+(行内提示符格式):**
1. 找到最后一行"提示符带输入"(`💫 message text`)
2. 收集该行与下一个裸提示符(`💫`)之间的全部内容
3. 过滤掉思考过程的 bullet 项(带灰色 ANSI 样式的 `•` 行)

**v1.20.0 之前(输入框格式):**
1. 找到最后一个用户输入框(以 `╭─` / `╰─` 为边框)
2. 收集输入框结束位置与下一个提示符之间的全部内容
3. 过滤掉思考过程的 bullet 项

**兜底**(响应过长导致标记滚出捕获区时):提取到最后一个空闲提示符为止的全部内容,并过滤掉 TUI 装饰元素。

### 思考 bullet 与响应 bullet 的区分

思考行和响应行都使用 `•`(bullet)前缀。该 provider 通过原始终端输出中的 ANSI 颜色码来区分它们:

- **思考**:`\x1b[38;5;244m•`(灰色 244 + 斜体)
- **响应**:不带 ANSI 颜色前缀的纯 `•`

## Agent Profile

对 Kimi CLI 而言,agent profile 是**可选的**。如果提供了 profile,该 provider 会:

1. 创建一个临时的 YAML agent 文件,继承 Kimi 内置的 `default` agent
2. 将 system prompt 写入一个单独的 markdown 文件
3. 通过 `--agent-file` 传入该 agent 文件

### Agent 文件格式

```yaml
version: 1
agent:
  extend: default
  system_prompt_path: ./system.md
```

当 provider 的 `cleanup()` 方法被调用时,临时文件会自动清理。

## MCP Server 配置

来自 agent profile 的 MCP server 通过 `--mcp-config` 以 JSON 字符串形式传入:

```bash
kimi --yolo --mcp-config '{"server-name": {"command": "npx", "args": ["-y", "cao-mcp-server"]}}'
```

### MCP 工具调用超时

Kimi CLI 默认的 MCP 工具调用超时为 60 秒(`~/.kimi/config.toml` 中的 `tool_call_timeout_ms=60000`)。这对 `handoff` 操作来说太短——`handoff` 需要创建 worker 终端、等待完成并提取输出,通常会超过 60 秒。

当配置了 MCP server 时,该 provider 会自动修改 `~/.kimi/config.toml`,将 `tool_call_timeout_ms` 设为 `600000`,把超时提高到 600 秒(10 分钟),与 CAO 默认的 handoff 超时一致。原始值会在 `cleanup()` 时恢复。这与 Gemini CLI provider(`~/.gemini/settings.json`)使用的"直接写配置"模式相同。

**为什么不用 `--config` flag?** Kimi CLI 的 `--config` flag 会让它绕过默认配置文件(`~/.kimi/config.toml`),这会破坏 OAuth 认证——CLI 会显示 "model: not set",`/login` 也无法工作。直接修改配置文件可避免此问题。

如果没有这一覆盖,主管(supervisor)Kimi CLI agent 会在 60 秒后收到 `ToolError("Timeout while calling MCP tool handoff")`,即使此时 worker 仍在处理中。

### CAO_TERMINAL_ID 转发

Kimi CLI 不会自动把父 shell 的环境变量转发给 MCP 子进程。该 provider 会显式地将 `CAO_TERMINAL_ID` 注入到每个 MCP server 配置的 `env` 字段中,以便 `handoff` 和 `assign` 等工具能在同一个 tmux 会话中创建新的 agent 窗口(而不是创建独立的会话)。已有的 `env` 条目会被保留,并且绝不会覆盖已存在的 `CAO_TERMINAL_ID` 值。

## 命令 Flag

| Flag | 用途 |
|------|------|
| `--yolo` | 自动批准所有工具动作的确认提示 |
| `--agent-file FILE` | 自定义 agent YAML 文件 |
| `--mcp-config TEXT` | MCP server 配置(JSON,可重复) |
| `--work-dir DIR` | 设置工作目录 |
| `--no-thinking` | 禁用思考模式(提示符变为 ✨) |

## 实现说明

### Provider 生命周期

1. **初始化**:创建唯一的临时目录 → 在 `~/.kimi/config.toml` 中设置 MCP 超时(若有 MCP server) → 等待 shell 就绪 → 发送 `cd <tempdir> && TERM=xterm-256color kimi --yolo` → 等待 IDLE 或 COMPLETED(最长 120 秒)
2. **状态检测**:检查底部 50 行中的空闲提示符模式(行尾锚定)
3. **消息提取**:基于行的处理方式,将原始输出与清洗后输出做映射以过滤思考内容
4. **退出**:发送 `/exit` 命令
5. **清理**:移除临时 agent 文件,恢复 config.toml 中的 MCP 超时,重置状态

### 终端输出格式(v1.20.0+)

```
╭────────────────────────────────────────────────────────╮
│ Welcome to Kimi Code CLI!                              │
╰────────────────────────────────────────────────────────╯
💫 create a function
• [thinking] Let me create the function...
• Here is the function:

def greet(name):
    return f"Hello, {name}!"

💫
```

### Kimi CLI v1.20.0 兼容性

该 provider 处理了若干 v1.20.0 的行为变化:

- **提示符格式**:从 `user@dirname💫` 变为裸 `💫`。空闲模式使用了可选前缀。
- **输入显示**:移除了带边框的输入框(`╭─...╰─`)。用户输入现在以行内形式出现在提示符所在行(`💫 message text`)。
- **TERM 变量**:当 `TERM=tmux-256color`(tmux 默认值)时,Kimi CLI 会静默退出。该 provider 用 `TERM=xterm-256color` 进行覆盖。
- **按目录加锁**:同一个目录中只能运行一个 Kimi 实例。每个 provider 实例通过 `cd` 使用自己的临时目录。

## E2E 测试

```bash
# 运行所有 Kimi CLI E2E 测试
uv run pytest -m e2e test/e2e/ -v -k kimi_cli

# 运行特定测试类型
uv run pytest -m e2e test/e2e/test_handoff.py -v -k kimi_cli
uv run pytest -m e2e test/e2e/test_assign.py -v -k kimi_cli
uv run pytest -m e2e test/e2e/test_send_message.py -v -k kimi_cli
uv run pytest -m e2e test/e2e/test_supervisor_orchestration.py -v -k KimiCli -o "addopts="
```

E2E 测试的前置条件:
- CAO 服务在运行(`cao-server`)
- `kimi` CLI 已认证(`kimi login`)
- agent profile 已安装(`cao install developer`)

## 故障排查

### 无法检测到 Kimi CLI

```bash
# 验证 kimi 在 PATH 中(命令名为 `kimi`,不是 `kimi-cli`)
which kimi
kimi --version
```

### 认证问题

```bash
# 重新认证
kimi login
```

### 初始化超时

如果 Kimi CLI 启动过慢,请检查:
- 网络连接(Kimi 需要 API 访问)
- 认证状态(`kimi login`)
- provider 最多等待 120 秒用于初始化

### 无法检测到状态栏

该 provider 会检查底部 50 行以寻找空闲提示符(`IDLE_PROMPT_TAIL_LINES = 50`)。这是为了应对 Kimi TUI 在提示符与状态栏之间的填充行,其数量会随终端高度变化(例如一个 46 行的终端约有 32 行空填充)。如果 Kimi 的 TUI 布局发生重大变化,这个常量可能需要调整。
