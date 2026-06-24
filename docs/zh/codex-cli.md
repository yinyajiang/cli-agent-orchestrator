# Codex CLI Provider

## 概览

Codex CLI provider 让 CLI Agent Orchestrator(CAO)能够通过你的 OpenAI API key 与 **Codex CLI**(OpenAI 的编码 agent)配合工作,从而让你可以编排多个基于 Codex 的 agent。

## 快速开始

### 前置条件

1. **OpenAI API Key** 或 **ChatGPT 订阅**:用于 Codex CLI 鉴权
2. **Codex CLI**:通过 npm 安装该 CLI 工具
3. **tmux**:终端管理所必需

```bash
# Install Codex CLI
npm install -g @openai/codex

# Authenticate (set API key)
export OPENAI_API_KEY=your-key-here
# Or use interactive login
codex login
```

### 在 CAO 中使用 Codex Provider

使用 Codex provider 创建一个 terminal:

```bash
# Start the CAO server in one terminal
cao-server

# In another terminal, launch a Codex-backed CAO session
cao launch --agents codex_developer --provider codex
```

你也可以通过 HTTP API(查询参数)创建 session:

```bash
curl -X POST "http://localhost:9889/sessions?provider=codex&agent_profile=codex_developer"
```

## 功能特性

### 状态检测

Codex provider 会自动检测 terminal 的状态:

- **IDLE**:terminal 已就绪,等待输入
- **PROCESSING**:Codex 正在思考或工作中
- **WAITING_USER_ANSWER**:等待用户批准/确认
- **COMPLETED**:任务已完成,并带有了 assistant 的响应
- **ERROR**:执行过程中发生了错误

该 provider 支持两种用于状态检测的输出格式:

- **Label 风格**:`You ...` / `assistant: ...`(合成/测试格式)
- **Bullet 风格**:`› user message` / `• response`(真实的 Codex 交互模式)

`USER_PREFIX_PATTERN` 使用 `[^\S\n]`(仅匹配水平空白)以避免跨换行匹配,从而正确区分 `› `(空闲提示符)和 `› text`(用户输入)。

### 消息抽取

该 provider 使用两阶段方法,自动从 terminal 输出中抽取最后一条 assistant 响应:

1. **主策略**:找到最后一条用户消息(`You ...` 或 `› text`),抽取它与下一个空闲提示符之间的所有内容
2. **回退策略**:当找不到用户消息时,使用 assistant 标记(`assistant:` 或 `•`)

这种方式对 label 格式(`assistant: response`)和 Codex 原生的 bullet 格式(`• response with multiple bullets`)都适用。

## 配置

CAO 的 Codex provider 会以兼容 tmux 的 flag 启动 `codex`,并依赖你已有的 Codex CLI 配置/鉴权。

- `--provider codex` 用于选择 provider。
- `--agents <name>` 用于指定 agent profile。当所提供的 agent profile 包含 `system_prompt` 时,它会通过 `-c` 配置覆盖 flag 以 `developer_instructions` 的形式注入到 Codex 中。
- model/timeout/approval 设置在 Codex CLI 自身中配置(在 CAO 之外)。

### Agent Profile 集成

当你用 agent profile(例如 `--agents code_supervisor`)启动时,CAO 会:

1. 从 agent store(内置,或 `~/.aws/cli-agent-orchestrator/agent_store/`)加载 agent profile
2. 从该 profile 的 Markdown 内容中抽取 `system_prompt`
3. 通过 `-c developer_instructions="<prompt>"` 把它传给 Codex,Codex 会将其作为 developer 角色消息注入

这样 Codex 就能像其他 provider 一样,按照特定角色指令(supervisor、developer、reviewer 等)运行。

### MCP Server 集成

如果 agent profile 包含 `mcpServers`,CAO 会通过 `-c mcp_servers.<name>.<field>=<value>` 配置覆盖把每个 MCP server 注入到 Codex 中。这是按 session 生效的,不会修改用户全局的 `~/.codex/config.toml`。

例如,`code_supervisor` profile 包含 `cao-mcp-server`,它提供 `handoff` 和 `send_message` 工具。这让 supervisor agent 能够通过 CAO 的多 agent 编排把工作委派给 Developer 和 Reviewer agent。

CAO 还会为每个 MCP server 设置 `tool_timeout_sec=600.0`(10 分钟),以支持像 handoff 这类长时间运行的操作。**重要**:该值必须是 TOML 浮点数(`600.0`,而不是 `600`),因为 Codex 通过 `Option<f64>` 反序列化这个字段。TOML 整数会被静默拒绝,并回退到默认的 60 秒。

### Memory 注入

当 CAO 的 memory 系统启用时,内置的 `codex_memory` 插件会在创建 terminal 时把相关的 memory 自动注入到项目中。对于一个 `codex` terminal,在 `post_create_terminal` 时它会向 `<cwd>/AGENTS.md` 写入一个带定界符的块 —— 该文件正是 Codex CLI 从工作目录中读取的项目指令文件:

```markdown
<!-- cao-memory:begin -->
<cao-memory>
## Context from CAO Memory
- [project] testing-framework: Always use pytest for this project
...
</cao-memory>
<!-- cao-memory:end -->
```

由于 `AGENTS.md` 是用户手写、位于仓库根目录的文件,该插件**只**拥有这块带定界符的区域,并在每次运行时原地替换它 —— 周围任何手写内容都会被保留(这与 Claude Code 的 `CLAUDE.md` 插件做法相同,而非 Kiro 那种对整个文件的占用)。该插件是只观察型的:它在 terminal 创建之后运行,任何错误都会被记录并跳过,绝不会让 `cao-server` 崩溃。当 memory 被禁用或没有相关 memory 时,它什么也不写。完整的 memory 系统请参见 [memory.md](memory.md)。

### 启动 Flag

Codex provider 会自动添加以下 flag 以兼容 tmux:

- `--no-alt-screen`:让 Codex 以 inline 模式运行,输出留在正常的 scrollback 中,从而保证 `tmux capture-pane` 可靠
- `--disable shell_snapshot`:避免 shell_snapshot 子进程在 tmux 中继承 stdin 导致的 TTY 输入冲突(SIGTTIN)

默认情况下,CAO 还会传递 `--yolo`(`--dangerously-bypass-approvals-and-sandbox` 的别名),因为 CAO agent 运行在非交互式 tmux session 中,审批提示会阻塞 handoff/assign 流程。profile 可以通过 `codexProfile` 选择退出;参见[自定义 Codex Profile](#custom-codex-profile)。任何不受限制的 allowed-tools 配置(`allowedTools: ["*"]`、`--allowed-tools '*'`,或 `cao launch --yolo`)无论 profile 如何设置,都会强制启用 `--yolo`。

### 自定义 Codex Profile

agent profile 上的 `codexProfile` 字段会指向你 `~/.codex/config.toml` 中某个 `[profiles.<name>]` 块。设置后,CAO 会丢弃 `--yolo`,改为传递 `--profile <name>`,从而让用户命名的 profile 来掌管沙箱与审批行为。不受限制的 allowed tools(`allowedTools: ["*"]`、`--allowed-tools '*'`,或 `cao launch --yolo`)会覆盖该字段,并始终强制启用 `--yolo`。

**重要 —— 仅限非交互**:CAO 的状态检测器无法与 Codex 当前的框式审批 UI(`Command Approval Required / [a] Accept / [d] Decline`)交互。你引用的任何 `codexProfile` 都**必须**解析为非交互的权限层级,否则 CAO session 会因为等待一个无人能响应的输入而超时。安全的形态:

- **只读 / 审计 agent**:`approval_policy = "never"` + `sandbox_mode = "read-only"` —— 写入/网络/逃逸尝试会失败关闭,并向模型返回错误。
- **允许写入的 agent**:`approval_policy = "never"` + `sandbox_mode = "workspace-write"` —— 工作区内的写入可以执行;沙箱逃逸会失败关闭。
- **Smart Approvals(由分类器判定)**:`approval_policy = "on-request"` + `sandbox_mode = "workspace-write"` + `approvals_reviewer = "auto_review"` —— 由 auto-review 分类器决定是否升级;拒绝会失败关闭,不会弹提示。

避免使用 `approval_policy = "untrusted"`,或者没有 `approvals_reviewer = "auto_review"` 的 `approval_policy = "on-request"` —— 这些层级会向用户弹提示,而 CAO 无法应答。

示例 —— 一个在 Codex 只读沙箱中运行的 reviewer:

```markdown
---
name: reviewer
description: Code Reviewer
provider: codex
role: reviewer
codexProfile: cao_reviewer
---

You review code for quality and correctness.
```

对应的 `~/.codex/config.toml`:

```toml
[profiles.cao_reviewer]
sandbox_mode = "read-only"
approval_policy = "never"
```

### 内联 Codex 配置覆盖

agent profile 上的 `codexConfig` 字段是一个 Codex 配置覆盖的 map,CAO 会在启动时将其作为 `-c key=value` flag 传入 —— 与 `developer_instructions` 和 `mcpServers` 使用的是同一机制。它让某个 profile 能够设置 per-agent 的 Codex 旋钮(reasoning effort、service tier、fast mode、model……),而**无需编辑全局的 `~/.codex/config.toml`,也无需维护命名 profile 文件**。

- **键**可以是 Codex 配置 schema 中的点分路径(例如 `model_reasoning_effort`、`service_tier`、`features.fast_mode`)。
- **值**会被序列化为 TOML 标量:字符串带引号,布尔值和数字裸写。因此 `model_reasoning_effort: "xhigh"` 会变成 `-c model_reasoning_effort="xhigh"`,`features.fast_mode: true` 会变成 `-c features.fast_mode=true`。
- 覆盖在默认的 `--yolo` 路径和 `--profile <codexProfile>` 路径下**都**会生效,所以无论是否有命名 profile 掌管沙箱/审批,effort/fast-mode 旋钮都能工作。
- `codexConfig` 可以与 `codexProfile` **组合使用**。由于 Codex 最后才应用 CLI `-c` 覆盖,所以同时出现在两者中的键,以 `codexConfig` 的为准。
- 作用域是 per-session:不会向用户的全局 `~/.codex/config.toml` 写入任何内容。

示例 —— 一个固定为高 reasoning effort 和 fast mode 的 developer agent:

```markdown
---
name: backend-developer
description: Backend developer agent
provider: codex
role: developer
codexConfig:
  model_reasoning_effort: "xhigh"
  service_tier: "fast"
  features.fast_mode: true
---

You implement backend changes from a task spec.
```

这会以 `codex --yolo … -c model_reasoning_effort="xhigh" -c service_tier="fast" -c features.fast_mode=true` 的方式启动 Codex,把 effort 和 fast-mode 设置只应用到该 agent。

## 工作流

### 1. 交互式单 agent 任务

```bash
cao launch --agents codex_developer --provider codex
```

在 tmux 窗口中,在 Codex 的提示符处输入你的 prompt。

获取 CAO terminal id(对 API 自动化/MCP 很有用):

```bash
echo "$CAO_TERMINAL_ID"
```

### 2. 通过 HTTP API 自动化 send/get-output

```bash
python3 - <<'PY'
import time

import requests

terminal_id = "<terminal-id>"

requests.post(
    f"http://localhost:9889/terminals/{terminal_id}/input",
    params={"message": "Please review this Python code for security issues"},
).raise_for_status()

# Poll status until completion
while True:
    status = requests.get(f"http://localhost:9889/terminals/{terminal_id}").json()["status"]
    if status in {"completed", "error", "waiting_user_answer"}:
        break
    time.sleep(1)

resp = requests.get(
    f"http://localhost:9889/terminals/{terminal_id}/output",
    params={"mode": "last"},
)
resp.raise_for_status()
print(resp.json()["output"])
PY
```

## 鉴权

### OpenAI API Key 设置

1. **安装 Codex CLI**:
   ```bash
   npm install -g @openai/codex
   ```

2. **鉴权**(二选一):
   ```bash
   # Option 1: Set environment variable
   export OPENAI_API_KEY=your-key-here

   # Option 2: Interactive login
   codex login
   ```

3. **验证安装**:
   ```bash
   codex --version
   ```

## 故障排查

### 常见问题

1. **鉴权失败**:
   ```bash
   # Re-authenticate
   codex logout
   codex login
   # Or set API key directly
   export OPENAI_API_KEY=your-key-here
   ```

2. **超时 / 任务挂起**:
   - 确认 `codex` 在普通 shell 中能正常工作(`codex`,然后退出)
   - attach 到 tmux session,检查 Codex 是否在等待输入/审批
   - 核实你的 OpenAI API key 或 ChatGPT 订阅,以及网络连通性

3. **状态检测问题**:
   - 检查 terminal 历史记录中是否有意外提示符
   - 确认 Codex CLI 版本兼容性
   - 复查自定义 prompt 模式

## 实现说明

- 命令构建由 `CodexProvider._build_codex_command()` 处理,它会用各种 flag 和可选的 `developer_instructions` 构造启动命令。
- 在启动 Codex 之前,会先发送一条 `echo ready` 的预热命令,以防止在全新的 tmux session 中立即退出。
- 工作区信任提示会在初始化阶段由 `CodexProvider._handle_trust_prompt()` 自动接受。
- 状态检测采用底部 N 行的方式(`IDLE_PROMPT_TAIL_LINES = 5`),检查最后几行是否为空闲提示符,因为 `--no-alt-screen` 模式会把历史保留在 scrollback 中。
- `ASSISTANT_PREFIX_PATTERN` 同时匹配 `assistant:`(label 风格)和 `•`(Codex bullet 风格),用于检测用户消息之后的 assistant 响应。
- `USER_PREFIX_PATTERN` 同时匹配 `You`(label 风格)和 `› text`(Codex 交互式提示符),并使用 `[^\S\n]` 防止跨换行匹配。
- `IDLE_PROMPT_STRICT_PATTERN` 只匹配空的提示符行(没有后续文本的 `› ` 或 `❯ `),用于抽取边界检测。
- 输出模式 `last` 使用 `CodexProvider.extract_last_message_from_script()`,它会抽取最后一条用户消息与下一个空闲提示符之间的文本。
- 退出 Codex terminal 使用 `/exit`(`POST /terminals/{terminal_id}/exit`)。
- **Handoff 消息上下文**:`_handoff_impl()` 会在任务消息前加上一个 `[CAO Handoff]` 前缀,以便 worker agent 知道这是一次阻塞式 handoff。否则,Codex agent 会主动尝试用 `send_message` 通知 supervisor,但因为 worker 没有 supervisor 的 terminal ID 而失败。这个前缀告诉 agent 直接输出结果并结束 —— orchestrator 会自动捕获响应。
- **TUI footer 处理**(`--no-alt-screen` 模式):即使在处理过程中,Codex 也会在底部持续渲染一个 TUI footer。footer 的格式随版本变化:v0.110 及更早版本使用 `› [suggestion hint]` + `? for shortcuts` + `N% context left`;v0.111+(PR #13202)使用 `› [suggestion hint]` + `model · N% left · path`。`TUI_FOOTER_PATTERN` 会检测这两种格式,`_compute_tui_footer_cutoff()` 会找到 footer 区域的精确起始位置。`get_status()` 和 `extract_last_message_from_script()` 都使用这个 cutoff 来排除 footer 行,使其不参与用户消息匹配 —— 从而避免误判 IDLE 和污染抽取。
- **TUI 进度 spinner**:处理过程中,Codex 会内联显示 `• [text] (Ns • esc to interrupt)`。这里的 `•` 会误匹配 `ASSISTANT_PREFIX_PATTERN`,而 TUI 的 `›` 提示会匹配空闲提示符 —— 从而触发误判 COMPLETED。`TUI_PROGRESS_PATTERN` 会检测该 spinner,并在 COMPLETED 检查之前返回 PROCESSING。

### 状态值

- `TerminalStatus.IDLE`:已就绪,等待输入
- `TerminalStatus.PROCESSING`:正在处理任务
- `TerminalStatus.WAITING_USER_ANSWER`:等待用户输入
- `TerminalStatus.COMPLETED`:任务已完成
- `TerminalStatus.ERROR`:发生了错误

## 最佳实践

### 1. Agent 命名

给 Codex agent 起描述性的名字:
- `codex-frontend-dev` - 前端开发
- `codex-security-reviewer` - 安全代码审查
- `codex-api-designer` - API 设计与文档

### 2. 任务拆解

把复杂任务拆成更小、更聚焦的 prompt:
```python
# Instead of:
"Build a complete web application"

# Use:
"Design the database schema for user authentication"
"Implement the authentication API endpoints"
"Create the login form component"
"Write tests for the authentication flow"
```



## 端到端测试

E2E 测试套件会针对真实的 CLI provider 验证 handoff、assign 和 send_message 流程。

### 测试结构

```
test/e2e/
├── conftest.py                        # Shared fixtures (server health, CLI checks, helpers)
├── test_handoff.py                    # Worker lifecycle tests (handoff) — 10 tests (2 per provider)
├── test_assign.py                     # Worker lifecycle tests (assign) — 10 tests (2 per provider)
├── test_send_message.py               # Inbox delivery tests — 5 tests (1 per provider)
└── test_supervisor_orchestration.py   # Supervisor→worker delegation tests — 10 tests (2 per provider)
```

### 前置条件

- 正在运行的 CAO server:`uv run cao-server`
- 已鉴权的 CLI 工具:`codex`、`claude`、`kiro-cli`
- 已安装 tmux
- 已安装 agent profile:`analysis_supervisor`、`data_analyst`、`report_generator`
  ```bash
  cao install examples/assign/analysis_supervisor.md
  cao install examples/assign/data_analyst.md
  cao install examples/assign/report_generator.md
  ```

### 运行 E2E 测试

```bash
# Run all E2E tests (all providers)
uv run pytest -m e2e test/e2e/ -v

# Run for a specific provider
uv run pytest -m e2e test/e2e/ -v -k codex
uv run pytest -m e2e test/e2e/ -v -k claude_code
uv run pytest -m e2e test/e2e/ -v -k kiro_cli

# Run a specific test type
uv run pytest -m e2e test/e2e/test_handoff.py -v
uv run pytest -m e2e test/e2e/test_assign.py -v
uv run pytest -m e2e test/e2e/test_send_message.py -v
uv run pytest -m e2e test/e2e/test_supervisor_orchestration.py -v -o "addopts="
```

E2E 测试在默认的 `pytest` 运行中通过 `pyproject.toml` 里的 `-m 'not e2e'` addopts 被排除。

## 示例

参见 `examples/` 目录中的分步示例:
- `examples/codex-basic/` - Codex 基础用法(包含三个 agent profile)
- `examples/assign/` - assign(异步并行)工作流,含 data analyst 和 report generator

## 贡献

要为 Codex provider 贡献代码:

1. Fork 本仓库
2. 创建一个 feature 分支
3. 为新功能添加测试
4. 更新文档
5. 提交 pull request

## 支持

如有问题或疑问:
- GitHub Issues:[cli-agent-orchestrator](https://github.com/awslabs/cli-agent-orchestrator/issues)
- 文档:[Codex CLI Provider Docs](https://github.com/awslabs/cli-agent-orchestrator/blob/main/docs/codex-cli.md)
