# OpenCode CLI Provider

> ⚠️ **实验性。** 回到 supervisor 的多 agent 编排(`assign` / `send_message`)目前针对 [#203](https://github.com/awslabs/cli-agent-orchestrator/issues/203) 使用了一个临时的 OpenCode 专用 inbox 轮询回退方案。这能避免 OpenCode TUI 稳定后待处理的 supervisor inbox 消息卡住,但在 [#115](https://github.com/awslabs/cli-agent-orchestrator/pull/115) 用单一 coordinator 替换它们之前,投递仍未与即时路径和 watchdog 路径完全统一。

## 概览

OpenCode CLI provider 使 CLI Agent Orchestrator (CAO) 能够与 **OpenCode** 协作 —— OpenCode 是一个基于终端、拥有原生 agent 系统的 AI 助手。OpenCode 使用带 YAML frontmatter 的 Markdown 文件作为 agent 格式 —— 与 CAO 自己的 profile 格式几乎一致,这使得本集成格外干净。

## 前置条件

1. **OpenCode 二进制文件** —— 从 [opencode.ai](https://opencode.ai) 安装:
   ```bash
   npm install -g opencode-ai
   # 或
   curl -fsSL https://opencode.ai/install | bash
   ```
2. **Node.js 18+** —— OpenCode 的插件系统需要
3. **tmux 3.3+** —— CAO 的终端管理需要
4. **API 凭据** —— 按你想让 OpenCode 使用的模型 provider(Anthropic、OpenAI 等)配置,详见 [OpenCode 的认证文档](https://opencode.ai/docs/auth)

### 首次启动延迟

在一个全新的 CAO 配置目录(`~/.aws/opencode/`)上**首次启动**时,OpenCode 会运行 `npm install @opencode-ai/plugin` —— 约 57 MB 依赖,需要 **5–30 秒**安装。在安装完成之前,TUI 会显示为空白。这是预期行为;CAO 的 120 秒初始化超时会自动覆盖它。

后续启动约需 2 秒完成。

## 快速开始

### 1. 安装 agent profile

```bash
# 内置 profile
cao install code_supervisor --provider opencode_cli
cao install developer --provider opencode_cli
cao install reviewer --provider opencode_cli

# 自定义或示例 profile
cao install examples/assign/data_analyst.md --provider opencode_cli
cao install examples/assign/report_generator.md --provider opencode_cli
```

### 2. 启动 CAO server

```bash
uv run cao-server
```

### 3. 启动一个 agent

```bash
# 标准启动 —— 显示工具摘要并请求确认
cao launch --agents developer --provider opencode_cli

# 跳过 CAO 的启动时确认提示(工具限制仍被强制执行)
cao launch --agents developer --provider opencode_cli --auto-approve

# 指定模型覆盖
cao launch --agents developer --provider opencode_cli --model anthropic/claude-sonnet-4-6

# 不受限制的访问 —— 先安装带有 allowedTools: ["*"] 的 profile。
# `cao launch --yolo` 在 opencode_cli 上是空操作(见已知限制)。
cao install developer --provider opencode_cli   # profile 必须带 allowedTools: ["*"]
cao launch --agents developer --provider opencode_cli
```

通过 HTTP API:

```bash
curl -X POST "http://localhost:9889/sessions?provider=opencode_cli&agent_profile=developer"
```

## 配置隔离

CAO 在运行 OpenCode 时把 `OPENCODE_CONFIG_DIR` 和 `OPENCODE_CONFIG` 都指向 `~/.aws/opencode/`,这与用户在 `~/.config/opencode/` 的个人 OpenCode 配置是分开的。这意味着:

- CAO 安装的 agent 会与内置 agent 一起出现在 OpenCode 的 agent 选择器中
- CAO 的 MCP 接线(`opencode.json`)永远不会触碰用户的个人配置
- 在 `cao launch` 和个人 `opencode` 使用之间切换是安全的 —— 它们使用独立的配置树

存储布局:

```
~/.aws/opencode/
├── opencode.json          # MCP server + 逐 agent 的工具门控(由 cao install 写入)
├── package.json           # 由 opencode 在首次启动时写入
├── node_modules/          # 约 57 MB,由 opencode 在首次启动时写入
└── agents/
    ├── code_supervisor.md
    ├── developer.md
    └── ...
```

## 权限与工具映射

OpenCode 通过每个 agent 文件中的 `permission:` YAML frontmatter 原生强制执行权限。CAO 在安装时把它的 `allowedTools` 列表翻译成 OpenCode 的 `permission:` 字典 —— **不需要在 `utils/tool_mapping.py` 中添加任何条目**。

权限决定由 CAO 拥有,因此翻译器只会输出 `allow` 或 `deny`。`ask` 值 —— OpenCode 原生的运行时提示 —— 被刻意从不写入,这使 OpenCode 与其他 CAO provider(Kiro、Q、Claude Code)保持一致,后者的允许工具都是直接放行的。

### 摘要

| CAO 类别 | 启用的 OpenCode 工具 |
|---|---|
| `execute_bash` | `bash` |
| `fs_read` | `read` |
| `fs_write` | `edit`、`write` |
| `fs_list` | `glob`、`grep` |
| `fs_*` | `read`、`edit`、`write`、`glob`、`grep` |
| `@<mcp-server-name>` | 在 `opencode.json` 中处理(不在 frontmatter 中) |

未在任何已启用类别中的工具默认为 `deny`。无论 `allowedTools` 如何设置,以下工具具有硬编码的策略:

| Tool | Policy | 原因 |
|---|---|---|
| `task` | deny | sub-agent 会逃出 CAO 的终端跟踪 |
| `question` | deny | 会无限期阻塞无人值守的流程 |
| `webfetch`、`websearch`、`codesearch` | deny | 网络外发 —— 仅按需启用 |
| `todowrite`、`skill` | allow | 内存中 / 仅追加,无副作用 |

若要允许包括上述在内的全部 13 个工具,请在 profile 中设置 `allowedTools: ["*"]` 并重新运行 `cao install`。与其他 provider 不同,`cao launch --yolo` **不会**在运行时为 `opencode_cli` 放宽权限 —— 见下方的 [`cao launch --yolo` 仅在安装时生效](#cao-launch---yolo-is-install-time-only)。

### `cao launch --auto-approve`

`cao launch` 上的 `--auto-approve` 与全仓库的语义一致:它只跳过 CAO 的启动时确认提示。工具限制仍被强制执行,且该标志不会修改 `OPENCODE_CONFIG_DIR` 中的任何文件。它**没有**对应的 `cao install` —— 安装时的权限完全由 profile 的 `allowedTools` / `role` 驱动。

## Skills

CAO 的 skills(例如 `cao-supervisor-protocols`、`cao-worker-protocols`)通过 OpenCode **原生的 `skill` 工具**并采用渐进式加载暴露给 OpenCode agent —— 它们**不会**被烘焙进 agent 的系统提示。

在 `cao install --provider opencode_cli` 时,CAO 会创建一个符号链接:

```
~/.aws/opencode/skills → ~/.aws/cli-agent-orchestrator/skills/
```

OpenCode 会自动发现 `<OPENCODE_CONFIG_DIR>/skills/`,并通过 `skill` 工具提供其内容。元数据(名称、描述)会预先列出;完整的 skill 正文按需加载。这意味着:

- 在 `~/.aws/cli-agent-orchestrator/skills/` 下新增或删除 skill 会在下一次 OpenCode 启动时生效,无需重新安装。
- agent 的系统提示保持精简 —— 只有 `profile.system_prompt`/`profile.prompt` 会被写入 `.md` 正文,不注入任何目录。
- CAO 的 `load_skill` MCP 工具仍作为访问同一内容的第二条路径保留(跨 provider 一致)。

## 状态检测

该 provider 从 tmux 捕获缓冲区(已剥离 ANSI)检测终端状态:

| 状态 | 标记 |
|---|---|
| `IDLE` | `ctrl+p commands` 页脚,无 `esc interrupt` |
| `PROCESSING` | `esc interrupt` 页脚快捷键 |
| `COMPLETED` | `▣ <agent> · <model> · Ns` 完成标记,后跟 idle 页脚 |
| `WAITING_USER_ANSWER` | `△ Permission required` 或 `△ Always allow` 标题 |
| `ERROR` | 兜底 —— 未匹配到任何状态标记 |

## MCP Server 接线

`cao install --provider opencode_cli` 把 MCP server 声明写入 `~/.aws/opencode/opencode.json`:

- 来自 agent profile 的每个 `mcpServers` 条目都会被添加到顶层 `mcp` 键下
- 该 server 的工具被全局默认拒绝(在 `tools` 下的 `"<servername>*": false`)
- 在 `agent.<agent_id>.tools` 下逐 agent 重新启用

agent ID 是 profile 名称经过斜杠处理后的形式(`/` → `__`) —— 与已安装的 `.md` 文件名以及运行时的 `opencode --agent <id>` 参数使用的标识符相同。这使文件名、`--agent` 参数和 `opencode.json` 的键对任意 profile 名都保持一致。

当重新安装的 agent 其 profile 不再声明 `mcpServers` 时,会显式地从 `opencode.json` 中移除其 `agent.<agent_id>` 条目,因此之前授予的 MCP 工具不会作为陈旧的授权残留下来。

`CAO_TERMINAL_ID` **不会**被写入 `opencode.json`。OpenCode 派生的 MCP 子进程会继承 tmux 窗口的环境,因此终端 ID 会自然传播 —— 这与 Kiro 使用的机制相同。

## 端到端测试

```bash
# 先安装 profile
cao install examples/assign/data_analyst.md --provider opencode_cli
cao install examples/assign/report_generator.md --provider opencode_cli
cao install developer --provider opencode_cli

# 启动 CAO server
uv run cao-server

# 运行全部 OpenCode CLI e2e 测试
uv run pytest -m e2e test/e2e/test_assign.py -k opencode -v

# 运行单个测试
uv run pytest -m e2e test/e2e/test_assign.py::TestOpenCodeCliAssign::test_assign_with_callback -v
```

`test_assign_with_callback` 测试验证全部四种编排模式:
- **assign**(非阻塞):supervisor 终端被创建并保持 IDLE
- **send_message**(inbox 投递):worker 把结果推送到 supervisor inbox
- **状态转换**:跨并发终端的 IDLE → PROCESSING → COMPLETED
- **handoff**(阻塞):inbox 投递触发 supervisor 状态转换

## 已知限制

### `cao launch --yolo` 仅在安装时生效

与其他所有 CAO provider 不同,`opencode_cli` 在运行时**不会**遵守 `cao launch --yolo`。权限在 `cao install` 时被烘焙进已安装 agent 的 frontmatter `permission:` 块,无法通过启动标志放宽。

根本原因:OpenCode 的 TUI(CAO 驱动的模式)没有与 `--dangerously-skip-permissions` / `--yolo` / `--trust-all-tools` 等价的东西。该标志只存在于 `opencode run` 这个无头一次性命令上,而 CAO 不使用它。上游追踪见 [sst/opencode#8463](https://github.com/sst/opencode/issues/8463) 及相关问题。

**要在 `opencode_cli` 上获得不受限制的访问:**

```bash
# 1. 编辑 profile 的 frontmatter,使其包含:
#    allowedTools: ["*"]

# 2. 重新运行 cao install —— 这会用所有工具设置为 allow 重写 permission: 块。
cao install my_agent --provider opencode_cli

# 3. 正常启动(省略 --yolo —— 它只会发出警告,且仍只遵守已安装的内容)。
cao launch --agents my_agent --provider opencode_cli
```

OpenCode 的 TUI 模式目前仍不支持运行时权限绕过。CAO 后续可以通过临时 agent 的变通方案,或在上游 TUI 标志推出后采用它来重新评估。

### 项目本地的 `opencode.json` 覆盖

OpenCode 的配置合并优先级把当前工作目录下的项目本地 `opencode.json` 置于 **`OPENCODE_CONFIG`**(CAO 管理的文件)**之上**。如果你在一个拥有自己的 `opencode.json`、且其中带有冲突 `agent.<name>.tools` 或 `tools` 条目的目录中执行 `cao launch`,CAO 的 MCP 接线可能会在该 agent 上被静默覆盖。

**变通方案:** 在启动 CAO 之前移除或重命名项目本地的 `opencode.json`,或把它移到 `.opencode/` 下(OpenCode 也会搜索这个子目录,但优先级更低)。

### 滚动会进入 tmux copy 模式

当你在 CAO 管理的 OpenCode 终端中滚动(鼠标滚轮或触控板)时,tmux 会进入 copy 模式,而不是滚动 TUI 的对话历史。这是刻意的。

CAO 在启动 OpenCode 时设置了 `OPENCODE_DISABLE_MOUSE=1`,这会阻止 OpenCode 请求应用鼠标上报模式(`\x1b[?1000h`)。没有这个请求,tmux 就不会把滚动事件转发给 OpenCode 进程 —— 它会拦截这些事件并进入 copy 模式。

做出这个取舍的原因是:如果由 OpenCode 拥有滚动事件,滚动对话历史会把完成标记(`▣ <agent> · <model> · Ns`)移出屏幕。页脚(`ctrl+p commands`、`esc interrupt`)被钉在 TUI 底部,无论滚动位置如何都保持可见,因此 IDLE 和 PROCESSING 检测不受影响。但 COMPLETED 检测要求完成标记和 idle 页脚同时出现在捕获的帧中 —— 如果标记被滚动移出,CAO 在 agent 完成后也永远检测不到 COMPLETED。禁用鼠标可使帧锁定到最近的渲染。

按 `q` 或 `Escape` 退出 copy 模式。如果你需要阅读更早的对话历史,请使用 `get_output` API 端点或 `/terminals/<id>/output` 端点来检索完整的捕获日志。

### `opencode.json` 并发写入

并行的 `cao install --provider opencode_cli` 调用(例如来自批处理脚本)可能会在共享的 `~/.aws/opencode/opencode.json` 文件上发生竞争。后一个写入者可能会覆盖前一个写入者的 agent 条目。**串行安装是安全的。** 文件锁推迟到未来版本实现。

## 故障排查

### 首次启动 TUI 空白(5–30 秒)

OpenCode 会在首次启动时把 `@opencode-ai/plugin` 安装到 `~/.aws/opencode/node_modules/`。在 `npm install` 完成之前,终端会显示为空白。CAO 的 120 秒初始化超时会自动覆盖这一过程。

若要在首次 CAO 启动前预填充 `node_modules/`(可选):
```bash
OPENCODE_CONFIG_DIR=~/.aws/opencode opencode --help
```

### server 报 "Unknown provider" 错误

请确保运行在 9889 端口上的 CAO server 是**开发版本**,而不是预装的二进制:
```bash
# 杀掉任何陈旧的已安装二进制
pkill -f 'cao-server'
# 启动开发 server
uv run cao-server
```

### 认证 / 模型错误

OpenCode 本身处理模型认证。请确认你已为想使用的模型 provider 设置好凭据。检查 `~/.config/opencode/opencode.json`(你的个人配置)中的 provider API 密钥,或在启动前通过环境变量设置。

### 权限提示阻塞了自动化流程

CAO 在权限 frontmatter 中只输出 `allow` 或 `deny`,因此对于 CAO 管理的工具,不应出现 `△ Permission required`。如果出现:
1. 验证 profile 的 `allowedTools` / `role` 是否授予了相关工具并重新安装 —— CAO 会把允许的工具直接翻译成 `permission: allow`。
2. 如果提示来自 CAO 词汇表之外的工具,请在 tmux 窗口中手动响应,或使用 `--yolo` 禁用所有限制 **(危险 —— 允许任何命令,包括 `aws`、`rm`、`curl`)**。

### 状态卡在 `PROCESSING`

这可能发生在以下情况:
- OpenCode 已启动但 TUI 尚未绘制(瞬时 —— 轮询器会自动恢复)
- 一次 `node_modules` 安装仍在进行中(等待最多 120 秒)
- `opencode` 二进制不在 tmux 窗口 shell 的 PATH 中(在 tmux 内检查 `echo $PATH`)
