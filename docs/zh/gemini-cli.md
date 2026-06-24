# Gemini CLI Provider

## 概述

Gemini CLI provider 让 CAO 能够配合 [Gemini CLI](https://github.com/google-gemini/gemini-cli)—— Google 的编程 agent CLI 工具使用。Gemini CLI 作为基于 Ink 的交互式 TUI 运行(不是 alternate screen 模式),并在 tmux 中保留滚动历史。

## 前置条件

- **Gemini CLI**:通过 `npm install -g @google/gemini-cli` 或 `npx @google/gemini-cli` 安装
- **认证**:运行 `gemini` 并按 OAuth 流程操作,或设置 `GEMINI_API_KEY`
- **tmux 3.3+**

验证安装:

```bash
gemini --version
```

## 快速开始

```bash
# 用 CAO 启动
cao launch --agents code_supervisor --provider gemini_cli
```

## 状态检测

provider 通过分析 tmux 终端输出来检测 Gemini CLI 状态:

| 状态 | 模式 | 描述 |
|--------|---------|-------------|
| **IDLE** | 底部出现 `*   Type your message` | 输入框可见,可接受输入 |
| **PROCESSING** | 底部没有空闲提示符,或可见 spinner(Braille 点 + "esc to cancel") | 响应正在流式输出或工具正在执行 |
| **COMPLETED** | 空闲提示符 + 用户查询(`>` 前缀)+ 响应(`✦` 前缀) | 任务已完成 |
| **ERROR** | `Error:`、`APIError:`、`ConnectionError:`、`Traceback` 模式 | 检测到错误 |

### 输入框结构

Gemini CLI 使用基于 Ink 的输入框,边框是块字符:

```
▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
 *   Type your message or @path/to/file
▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
```

## 消息提取

从终端输出中提取响应:

1. 找到最后一次用户查询(查询框内以 `>` 为前缀的行)
2. 收集查询与下一个空闲提示符之间的所有内容
3. 过滤掉 TUI 装饰:输入框边框(`▀▄`)、状态栏、YOLO 指示符、模型指示符
4. 返回清理后的响应文本

### 响应格式

Gemini CLI 对 assistant 响应使用 `✦`(U+2726,四角星)前缀:

```
✦ Here is the implementation:

def greet(name):
    return f"Hello, {name}!"
```

工具调用出现在圆角框中:

```
╭──────────────────────────────╮
│ ✓  ReadFile test.txt          │
╰──────────────────────────────╯
```

## Agent Profile

Agent profile 对 Gemini CLI 是**可选的**。当提供了 agent profile 时:

1. **System prompt**:通过两种机制注入:
   - **主要**:`-i`(prompt-interactive)flag 把 system prompt 作为第一条用户消息发送。Gemini 会强烈采纳 `-i` 所指定的角色,因此对 supervisor 编排很有效。
   - **补充**:写入工作目录中的 `GEMINI.md` 文件,作为持久化的项目级上下文。如果已存在 `GEMINI.md`,会备份为 `GEMINI.md.cao_backup`,并在清理时还原。

   注意:仅靠 `GEMINI.md` 不够 —— 模型把它当作弱背景上下文,并不会采纳 supervisor 角色。要可靠注入 system prompt,`-i` flag 是必需的。
2. **MCP server**:在启动 `gemini` 命令之前直接写入 `~/.gemini/settings.json`(见下文)。

## MCP Server 配置

来自 agent profile 的 MCP server,通过在启动 `gemini` 命令之前直接写入 `~/.gemini/settings.json` 来注册。这取代了之前链式调用 `gemini mcp add --scope user` 的方式(后者会为每个 server 拉起一个 Node.js 进程,每个约 2-3s 开销)。

```json
{
  "mcpServers": {
    "cao-mcp-server": {
      "command": "npx",
      "args": ["-y", "cao-mcp-server"],
      "env": { "CAO_TERMINAL_ID": "abc12345" }
    }
  }
}
```

### CAO_TERMINAL_ID 转发

`CAO_TERMINAL_ID` 被注入到 `settings.json` 中 MCP server 的 `env` 字段。这确保 `handoff` 和 `assign` 等工具会在同一个 tmux 会话中创建新的 agent 窗口。

### MCP Server 清理

当 provider 的 `cleanup()` 方法被调用时,会直接从 `~/.gemini/settings.json` 移除已注册的条目(不需要 Node.js 子进程)。

## 工具限制

Gemini CLI 通过 **Policy Engine** 实施工具限制 —— TOML deny 规则写入 `~/.gemini/policies/cao-{terminal_id}.toml`。Deny 规则会把工具完全从模型记忆中排除,即便在 `--yolo` 模式下也能硬限制。

| CAO `--yolo` | 行为 |
|---|---|
| **是**(`allowed_tools=["*"]`) | 仅 `gemini --yolo` —— 完全无限制 |
| **否**(受限工具) | `gemini --yolo` + TOML deny 规则 —— 自动批准允许的工具,硬阻止被拒工具 |

每个终端有自己独立的策略文件(以 `terminal_id` 为键),因此并发会话不会冲突。会话结束时该文件会被清理。

> **注意:**`settings.json` 中原先的 `excludeTools` 方式已被替换,因为 `--yolo` 会绕过 `excludeTools`(已在 Gemini CLI issue #20469 中确认)。Policy Engine deny 规则是推荐的替代方案,并在所有模式下都生效。

## 命令 Flag

| Flag | 用途 |
|------|---------|
| `--yolo` | 自动批准所有工具动作确认 |
| `--sandbox false` | 禁用沙箱模式(访问文件系统所需) |

## 实现说明

### Provider 生命周期

1. **初始化**:等待 shell → warm-up echo(验证 shell 就绪)→ 2s 沉降延迟 → 发送命令 → 等待 IDLE 或 COMPLETED(最长 240s;使用 `-i` 时,会等待 COMPLETED 以确保 system prompt 已被完整处理后再接受输入)
2. **状态检测**:检查最后 50 行寻找空闲提示符 + 处理 spinner(`IDLE_PROMPT_TAIL_LINES = 50`)
3. **消息提取**:基于行的处理,过滤 TUI 装饰
4. **退出**:发送 `C-d`(Ctrl+D)
5. **清理**:移除 MCP server,移除策略 TOML 文件,重置状态

### 终端输出格式

```
 ███ GEMINI BANNER
                                                  YOLO mode (ctrl + y to toggle)
▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
 > say hello
▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
  Responding with gemini-3-flash-preview
✦ Hello! How can I help you today?

▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
 *   Type your message or @path/to/file
▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
 .../project (main)   no sandbox   Auto (Gemini 3) /model | 199.2 MB
```

### 处理 Spinner 检测

Gemini 的 Ink TUI 在底部**始终**保留空闲输入框(`* Type your message`)可见,即使在处理过程中也是如此。这与其他 provider 不同 —— 后者在处理时空闲提示符会消失。为避免过早检测到 COMPLETED,`get_status()` 会在返回 COMPLETED 之前先检查底部行里是否有 Braille spinner 字符 + "(esc to cancel" 文本。

```
⠴ Refining Delegation Parameters (esc to cancel, 50s)
```

### 初始化后的状态覆盖(`mark_input_received`)

当使用 `-i` flag 时,Gemini CLI 会把 system prompt 当作第一条查询处理并产生响应,使终端进入 COMPLETED 状态。然而,MCP handoff 工具(运行在生产环境的 `cao-mcp-server` 中)会等待 IDLE 才发送其任务消息。如果不干预,handoff 就会超时。

provider 用 `mark_input_received()` 模式解决此问题:

1. 在使用 `-i` 的 `initialize()` 完成后,`get_status()` 返回 **IDLE**(而非 COMPLETED),因为唯一的查询/响应来自 system prompt
2. 当 `terminal_service.send_input()` 投递外部输入时,它会调用 `provider.mark_input_received()`,把 `_received_input_after_init` 置为 `True`
3. 该 flag 被置位后,`get_status()` 恢复正常的 COMPLETED 检测

一个 `_initialized` 守卫避免了鸡生蛋蛋生鸡的问题:在初始化过程本身期间,COMPLETED 检测正常工作,这样 `initialize()` 才能检测 `-i` 处理何时完成。

### IDLE_PROMPT_TAIL_LINES

设为 50。Gemini 基于 Ink 的 TUI 会在底部输入框与状态栏之间添加填充行。在高终端(例如 150x46)上,提示符可能离最后一行很远。50 行覆盖了约 60 行以内的终端。

## E2E 测试

```bash
# 运行所有 Gemini CLI E2E 测试
uv run pytest test/e2e/ -v -k Gemini -o "addopts="

# 运行特定测试类型
uv run pytest test/e2e/test_handoff.py -v -k Gemini -o "addopts="
uv run pytest test/e2e/test_assign.py -v -k Gemini -o "addopts="
uv run pytest test/e2e/test_send_message.py -v -k Gemini -o "addopts="
uv run pytest test/e2e/test_supervisor_orchestration.py -v -k Gemini -o "addopts="
```

E2E 测试前置条件:
- CAO 服务端正在运行(`cao-server`)
- `gemini` CLI 已认证
- Agent profile 已安装(`cao install developer`、`cao install examples/assign/analysis_supervisor.md`)

## 故障排查

### 未检测到 Gemini CLI

```bash
# 验证 gemini 在 PATH 上
which gemini
gemini --version
```

### 初始化超时

如果 Gemini CLI 启动耗时过长,请检查:
- 网络连通性(Gemini 需要 API 访问)
- 认证状态(重新运行 `gemini` 进行认证)
- MCP server 注册:验证 `~/.gemini/settings.json` 包含期望的 `mcpServers` 条目
- Shell 环境:provider 会发送一个 warm-up `echo` 命令并等待标记后再启动 `gemini`,确保 PATH/nvm/homebrew 已加载
- provider 最多等待 240 秒用于初始化(覆盖了通过 `uvx` 下载 MCP server 和 `-i` 提示处理)

### 在高终端上状态检测失效

provider 会检查最后 50 行寻找空闲提示符(`IDLE_PROMPT_TAIL_LINES = 50`)。这是为了应对 Gemini Ink TUI 在输入框与状态栏之间的填充行,该填充随终端高度变化。如果 Gemini 的 TUI 布局发生显著变化,可能需要调整该常量。
