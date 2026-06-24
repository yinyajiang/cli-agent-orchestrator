# Claude Code Provider

## 概述

Claude Code provider 让 CLI Agent Orchestrator(CAO)能够通过你的 Anthropic API key 或 Claude 订阅与 **Claude Code**(Anthropic 的 CLI)协同工作,从而让你可以编排多个基于 Claude 的 agent。

## 快速开始

### 前置条件

1. **Anthropic API Key** 或 **Claude 订阅**:用于 Claude Code 认证
2. **Claude Code CLI**:安装该 CLI 工具
3. **tmux**:终端管理所需

```bash
# 安装 Claude Code CLI
npm install -g @anthropic-ai/claude-code

# 认证
claude setup-token
```

### 在 CAO 中使用 Claude Code Provider

```bash
# 启动 CAO 服务
cao-server

# 启动一个基于 Claude Code 的会话
cao launch --agents developer --provider claude_code
```

通过 HTTP API:

```bash
curl -X POST "http://localhost:9889/sessions?provider=claude_code&agent_profile=developer"
```

## 功能特性

### 状态检测

Claude Code provider 通过分析输出模式来检测终端状态:

- **IDLE**:终端显示 `>` 或 `❯` 提示符,可接受输入
- **PROCESSING**:可见 spinner 字符(`✶`、`✢`、`✽`、`✻`、`·`、`✳`)及省略号和状态文本
- **WAITING_USER_ANSWER**:Claude 显示带编号的选项及 `❯` 光标
- **COMPLETED**:存在响应标记 `⏺` + 可见空闲提示符
- **ERROR**:无可识别的输出状态

状态检测按优先级顺序检查模式:PROCESSING → WAITING_USER_ANSWER → COMPLETED → IDLE → ERROR。

### 消息提取

该 provider 通过查找 `⏺` 响应标记来提取最后一条 assistant 响应:

1. 找出输出中所有的 `⏺` 标记
2. 取最后一个(最终响应)
3. 提取直到下一个 `>` 提示符或分隔线(`────────`)之前的文本
4. 从结果中去除 ANSI 码

### 绕过权限

默认情况下,CAO 启动 Claude Code 时会带上 `--dangerously-skip-permissions` 以绕过:
- **工作区信任对话框**:新目录下出现的 "Yes, I trust this folder" 提示
- **工具权限提示**:文件编辑、命令执行等的审批对话框

这是安全的,因为 CAO 在 `cao launch` 时已经确认过工作区信任("Do you trust all the actions in this folder?"),或通过 `--yolo` flag 确认。如果没有这个 flag,通过 handoff/assign 启动的 worker agent 会在信任对话框处阻塞,且无法以交互方式接受。

profile 可以通过设置 `permissionMode` 字段选择更严格的行为,这会让 provider 改为传入 `--permission-mode <value>` 而非 `--dangerously-skip-permissions`。见下文的 [Permission Mode Override](#permission-mode-override)。无论 profile 的 `permissionMode` 如何,`cao launch --yolo` 始终强制使用 `--dangerously-skip-permissions`。

此外还有一个兜底的 `_handle_trust_prompt()` 方法会监控信任对话框并发送 Enter 接受它,以防该 flag 不能覆盖所有场景。

## 配置

### Agent Profile 集成

当以某个 agent profile(例如 `--agents code_supervisor`)启动时,CAO 会:

1. 从 agent 存储中加载该 profile
2. 从 Markdown 内容中提取 system prompt
3. 通过 `--append-system-prompt` 传入(换行符转义为 `\n` 以兼容 tmux)
4. 如果 profile 定义了 `mcpServers`,则通过 `--mcp-config` JSON 注入 MCP server

### 启动命令

该 provider 通过 `_build_claude_command()` 构建命令:

```
claude --dangerously-skip-permissions [--append-system-prompt "..."] [--mcp-config "..."]
claude --permission-mode auto [--append-system-prompt "..."] [--mcp-config "..."]
```

### Permission Mode Override

agent profile 上的 `permissionMode` 字段允许你用更严格的 Claude Code 权限层级替代默认的 `--dangerously-skip-permissions` 绕过方式。

允许的取值:`default`、`acceptEdits`、`plan`、`auto`、`bypassPermissions`。各层级的具体行为见 [Claude Code 权限模式参考](https://code.claude.com/docs/en/permission-modes)。

设置后,该 provider 会传入 `--permission-mode <value>` 而非 `--dangerously-skip-permissions`。`cao launch --yolo` 始终覆盖此字段,无论 profile 如何设置都强制使用 `--dangerously-skip-permissions`。

示例——一个运行在 `auto` 权限分类器下(而非无条件绕过)的 reviewer:

```markdown
---
name: reviewer
description: Code Reviewer
provider: claude_code
role: reviewer
permissionMode: auto
---

You review code for quality and correctness.
```

## Eager Inbox 投递

Claude Code 的 Ink TUI 即便在 agent 处理过程中也会缓冲粘贴的输入。CAO 利用这一点在 PROCESSING 和 WAITING_USER_ANSWER 状态下投递排队的 inbox 消息,消除轮次间延迟。通过 `CAO_EAGER_INBOX_DELIVERY=true` 启用。

完整的架构、双 flag 门控机制,以及如何为其他 provider 启用该特性,见 [Inbox Delivery](inbox-delivery.md)。

## 原生 Agent 路由

当 CAO profile 指定了 `native_agent` 字段时,该 provider 会直接将 `--agent <name>` 传给 Claude Code 的原生 agent 存储(`~/.claude/agents/`)。这是一种薄包装模式,由 Claude Code 处理所有配置(MCP server、hooks、tools、model)。

如果给定 agent 名称没有找到对应的 CAO profile,该 provider 也会回退到 `--agent <name>`,假定它存在于原生存储中。

```markdown
---
name: my-wrapper
description: Thin wrapper for a native Claude Code agent
provider: claude_code
native_agent: my-native-agent
---
```

## 实现说明

- **提示符模式**:`IDLE_PROMPT_PATTERN` 同时匹配旧的 `>` 和新的 `❯` 提示符风格,包括不换行空格(`\xa0`)
- **ANSI 处理**:所有模式匹配都先通过 `ANSI_CODE_PATTERN` 去除 ANSI 码
- **处理中检测**:`PROCESSING_PATTERN` 同时匹配旧格式(`✽ Cooking… (esc to interrupt)`)和新的 Claude Code 2.x 格式(`✽ Cooking… (6s · ↓ 174 tokens · thinking)`)
- **信任提示符排除**:`TRUST_PROMPT_PATTERN`("Yes, I trust this folder")被排除在 `WAITING_USER_ANSWER` 检测之外,以避免初始化期间的误报
- **shell 转义**:使用 `shlex.join()` 安全地构造带多行 prompt 的命令
- **退出命令**:通过 `POST /terminals/{terminal_id}/exit` 发送 `/exit`

### 状态取值

- `TerminalStatus.IDLE`:可接受输入
- `TerminalStatus.PROCESSING`:正在处理任务
- `TerminalStatus.WAITING_USER_ANSWER`:等待用户输入
- `TerminalStatus.COMPLETED`:任务完成
- `TerminalStatus.ERROR`:发生错误

## 端到端测试

E2E 测试套件验证了 Claude Code 的 handoff、assign 和 send_message 流程。

### 运行 Claude Code E2E 测试

```bash
# 启动 CAO 服务
uv run cao-server

# 运行所有 Claude Code E2E 测试
uv run pytest -m e2e test/e2e/ -v -k claude_code

# 运行特定测试类型
uv run pytest -m e2e test/e2e/test_handoff.py -v -k claude_code
uv run pytest -m e2e test/e2e/test_assign.py -v -k claude_code
uv run pytest -m e2e test/e2e/test_send_message.py -v -k claude_code
uv run pytest -m e2e test/e2e/test_supervisor_orchestration.py -v -k ClaudeCode -o "addopts="
```

## 故障排查

### 常见问题

1. **信任对话框阻塞**:
   - Claude Code 应当自动带上 `--dangerously-skip-permissions` 启动
   - 如果信任对话框仍然出现,请检查 provider 代码中是否包含该 flag

2. **处理中检测失败**:
   - 验证 Claude Code CLI 版本(`claude --version`)
   - 较新版本可能使用不同的 spinner 格式——检查 `PROCESSING_PATTERN`

3. **认证问题**:
   ```bash
   claude setup-token
   # 或设置 ANTHROPIC_API_KEY 环境变量
   ```

4. **状态卡在 ERROR**:
   - 接入 tmux 会话并检查终端输出
   - 先在普通终端中确认 Claude Code 能正常启动
