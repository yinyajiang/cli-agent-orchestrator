# Cursor CLI Provider

## 概述

Cursor CLI provider 让 CLI Agent Orchestrator(CAO)能够配合 **[Cursor CLI](https://cursor.com/cli)**(主命令:`agent`,历史别名:`cursor-agent`)—— Anysphere 推出的终端原生 AI 编程助手使用。可用它在 CAO 中驱动 Cursor,与 Claude Code、Kiro CLI 以及 CAO 已支持的其他 provider 一起协同。

该 provider 实现了 [BaseProvider](https://github.com/awslabs/cli-agent-orchestrator) 接口,因此天然支持 handoff、assign 和 send_message 编排流程。

## 快速开始

### 前置条件

1. **Cursor 订阅或 API key** —— `agent login` 需要使用。
2. **Cursor CLI** —— 在 `$PATH` 中安装 `agent`(或旧版 `cursor-agent`)二进制。
3. **tmux** —— 终端管理所需。

```bash
# 安装 Cursor CLI(当前安装方法见 https://cursor.com/cli)
curl https://cursor.com/install -fsS | bash

# 认证
agent login
```

### 配合 CAO 使用 Cursor CLI Provider

```bash
# 启动 CAO 服务端
cao-server

# 启动一个基于 Cursor 的会话
cao launch --agents developer --provider cursor_cli
```

通过 HTTP API:

```bash
curl -X POST "http://localhost:9889/sessions?provider=cursor_cli&agent_profile=developer"
```

## 特性

### 状态检测

Cursor CLI provider 通过分析输出模式来检测终端状态。Cursor CLI v2026.06.15 在交互模式下运行完整的 Ink/TUI,因此检测同时覆盖旧版文本模式 REPL 和新版 TUI:

- **IDLE / COMPLETED(v2026+ TUI)**:状态栏(`Composer …` / `Run Everything`)可见,且输入框行上没有 `ctrl+c to stop` 提示。输入框回到占位符(首次启动时是 `Plan, search, build anything`,首轮对话后是 `Add a follow-up`)。
- **PROCESSING(v2026+ TUI)**:状态栏可见且输入框行上存在 `ctrl+c to stop` 提示。Cursor 在 agent 处理每轮任务时每一帧都会渲染该提示;响应完全交付后它就消失。
- **IDLE / COMPLETED(旧版文本模式)**:终端单独一行显示 `❯`(或 `>`)REPL 提示符,等待输入。
- **PROCESSING(旧版文本模式)**:spinner 字符(`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✶✢✽✻✳·`)带省略号,紧贴在 `──────────────────────` 分隔符前一行的位置。
- **WAITING_USER_ANSWER**:TUI 选择控件(模式选择器、模型选择器)显示 `↑/↓ to navigate` 页脚,或存在活动的工作区信任 / 工具权限对话框。
- **UNKNOWN**:无可识别状态。

状态检测按优先级顺序检查模式:PROCESSING → WAITING_USER_ANSWER → COMPLETED → UNKNOWN。

PROCESSING 检测是**结构性**的 —— 对旧版文本模式构建,它会从最后一个分隔符向上回溯寻找 spinner 行,这样之前已完成回合残留的 spinner 文本不会触发误报(与 Claude Code provider 采用的方式相同)。

对 v2026+ TUI 的检测,会参考滚动 8KB 缓冲区的尾部(最后约 1KB)。`ctrl+c to stop` 指示符在 Cursor TUI 的每一帧都渲染在输入框行最后几百字节处,因此 1KB 窗口远低于 8KB 上限,且只要 agent 正在工作中该指示符就会出现。

### 消息提取

Cursor CLI 不会发出单个标准响应标记(不像 Claude Code 的 `⏺`),所以 provider 使用结构化的**分隔符 + 尾部提示符**模式:

1. 找到位于尾部 `❯` 空闲提示符之前的最后一个 `──────────────────────` 分隔符。
2. 找到它之前的分隔符(或缓冲区起点)。
3. 提取两者之间的内容,并剥离完整的 ECMA-48 转义序列(CSI、OSC、2 字节 ESC)。

如果未检测到边界,提取会抛出 `ValueError("No Cursor CLI response found - no separator / idle prompt boundary detected")`。

> **注意:**v2026+ TUI 不会在 pipe-pane 缓冲区中输出 `─────` 分隔符或 `❯` 提示符(它们是 TUI 控件),因此在实时 TUI 流上做消息提取会返回 `ValueError`。提取 v2026 响应时,请在渲染后的 `capture-pane` 快照上调用 `get_output` API(该快照会把 TUI 渲染回文本模式流)。

### 权限绕过

默认情况下,CAO 启动 Cursor CLI 时会带上以下 flag 以跳过那些会阻塞无头编排的交互式对话框:

- `--force` —— 自动批准每一次工具调用(Bash、文件写入等)。
- `--approve-mcps` —— 预先批准通过 `--plugin-dir` 声明的 MCP server。

`--trust` **不会**传入,因为 Cursor CLI v2026+ 在交互式 REPL 模式下会拒绝它并报错 `Error: --trust can only be used with --print/headless mode`。CAO 启动流程已经确认了工作区信任,且交互式 REPL 中没有针对每个目录的信任对话框需要 `--trust` 去跳过。

这些 flag 可以安全设置,因为 CAO 在 `cao launch` 期间就已经确认了工作区信任("Do you trust all the actions in this folder?"),或通过 `--yolo` 确认。如果没有它们,每个通过 handoff/assign 派生的 worker agent 都会卡在权限对话框上,且无法交互式地接受。

## 配置

### Agent Profile 集成

以 agent profile(例如 `--agents code_supervisor`)启动时,CAO 会:

1. 从 agent store(`~/.aws/cli-agent-orchestrator/agent-store`)加载 profile。
2. 遵循 profile 的 `model` 字段,在启动时传入 `--model <id>`(可通过构造函数覆盖)。
3. 对于 MCP server:在 `~/.aws/cli-agent-orchestrator/tmp/<tid>-cursor-plugins/plugin.json` 下写入一个合成的 Cursor 插件清单,并通过 `--plugin-dir` 传入该目录。清单的 `mcpServers` 映射携带 `CAO_TERMINAL_ID` 环境变量,以便 MCP 工具识别当前终端用于 handoff/assign 操作。会加上 `--approve-mcps`,这样 REPL 就不会在每个 server 的批准对话框上阻塞。
4. 在 v2026.06.15 中**不会**通过 `--system-prompt` 传入 profile 正文:后端会拒绝每一个携带 `--system-prompt <file>` 载荷的请求并报 `[invalid_argument] unknown option '--system-prompt'`,无论文件内容如何(该 bug 用一个 3 字符文件即可复现)。CAO 的角色上下文仍然通过 `cao-mcp-server` MCP 工具的 handoff/assign 载荷送达 agent,因此 agent 拥有正确的能力和正确的 inbox 工具;只有角色正文没有被预加载为 system prompt。保留的 `_write_system_prompt_file` 辅助方法已就绪,待 Cursor 发布修复后的客户端即可重新启用此路径。

### 启动命令

provider 通过 `_build_cursor_command()` 构建命令。provider 优先使用明确的 `cursor-agent` 别名(只有 Cursor CLI 提供),并在仅安装了主命令 `agent` 时回退到官方主命令名。当选择 `agent` 时,provider 会运行 `agent --version` 探测,以确认解析到的二进制确实是 Cursor CLI(许多无关工具也会在 `$PATH` 上安装 `agent` 二进制)。

```
cursor-agent --force [--model <id>] [--plugin-dir <path> --approve-mcps]
```

`--print` flag **刻意不传**:CAO 驱动的是交互式 REPL,以便 inbox 服务通过 MCP handoff 流式传输后续提示。Print 模式是一个一次性 CLI flag,在第一次响应后即退出,因此与多轮 CAO 会话不兼容。

### 模型覆盖

provider 按以下优先级顺序转发模型选择:

1. profile 的 `model` 字段(当 agent profile 上设置了该字段时)。
2. 构造函数提供的 `model` 参数(例如来自 `cao launch --model gpt-5`)。
3. 不传 `--model` flag(Cursor 使用用户的默认模型)。

## 工具限制

Cursor CLI v2026 没有暴露 `--disallowedTools`(或等价物)flag 用于硬工具限制,而且 provider 在早期构建中使用的软限制路径(把 `SECURITY_PROMPT` + 允许列表前置到 system prompt)在 v2026 中**不可用**,因为 provider 不再传 `--system-prompt`(见上文"Agent Profile 集成")。在 Cursor v2026 上限制工具访问的推荐路径是选择一个支持原生限制机制的 provider:

- **硬限制**:优先选择 Claude Code、Copilot CLI 或 Gemini CLI,它们都支持 `--disallowedTools`。
- **OpenCode**:OpenCode CLI 的 frontmatter 机制允许 supervisor 限制每个 agent 的能力。
- **仅建议性(Cursor v2026)**:如果必须使用 `cursor_cli` 并限制工具,请配置一个专用的免费额度账号 + 工作区,并使用 Cursor 自己的权限 UI 来限定 agent 能做什么。CAO 的 `allowed_tools` 参数在 v2026 的 `cursor_cli` 上当前被忽略,这一点已在文档中说明。

关于三种限制方式,见 `docs/tool-restrictions.md` 和 `skills/cao-provider/references/lessons-learnt.md` #13。

## 端到端测试

E2E 测试套件会针对每个支持的 provider 验证完整的编排矩阵(handoff、assign、send_message、allowedTools、supervisor 编排)。Cursor CLI 的 11 个核心 e2e 测试位于 `test/e2e/` 下的 `TestCursorCli*` 测试类中,并沿用其他 provider 使用的相同 `_run_*_test()` 辅助方法。

### 前置条件

1. **Cursor CLI**(`agent` 或 `cursor-agent`)已安装并认证。
2. **CAO 服务端**正在运行(`uv run cao-server`)。
3. 已为 cursor_cli provider 安装了 **agent profile**(`examples/assign/` 中随仓库发布的 profile 是与 provider 无关的;你可以在安装时固定到 `cursor_cli`,也可以通过 frontmatter `provider: cursor_cli` 固定):

   ```bash
   cao install examples/assign/data_analyst.md --provider cursor_cli
   cao install examples/assign/report_generator.md --provider cursor_cli
   cao install developer --provider cursor_cli  # 用于 handoff / send_message 测试
   ```

4. **tmux** 在 `$PATH` 上可用。

### 运行 Cursor CLI E2E 测试

默认的 pytest `addopts` 排除了 `e2e` marker,因此需要 `-o "addopts="` 覆盖才能启用它们:

```bash
# 启动 CAO 服务端
uv run cao-server

# 所有 Cursor CLI e2e 测试
uv run pytest -m e2e test/e2e/ -v -k cursor_cli -o "addopts="

# 单个流程文件
uv run pytest -m e2e test/e2e/test_handoff.py -v -k cursor_cli -o "addopts="
uv run pytest -m e2e test/e2e/test_assign.py -v -k cursor_cli -o "addopts="
uv run pytest -m e2e test/e2e/test_send_message.py -v -k cursor_cli -o "addopts="
uv run pytest -m e2e test/e2e/test_allowed_tools.py -v -k cursor_cli -o "addopts="
uv run pytest -m e2e test/e2e/test_supervisor_orchestration.py -v -k cursor_cli -o "addopts="
```

### 11 个核心 E2E 测试

| 序号 | 测试类 | 验证内容 |
|---|------------|-------------------|
| 1 | `TestCursorCliHandoff::test_handoff_simple_function` | Worker 创建一个 Python 函数,返回可提取的输出 |
| 2 | `TestCursorCliHandoff::test_handoff_second_task` | 同一终端处理第二个任务,无状态泄漏 |
| 3 | `TestCursorCliAssign::test_assign_data_analyst` | `data_analyst` profile 对数据集产出统计分析 |
| 4 | `TestCursorCliAssign::test_assign_report_generator` | `report_generator` profile 创建结构化报告模板 |
| 5 | `TestCursorCliAssign::test_assign_with_callback` | Worker 完成 → inbox 回调 → supervisor 收到结果 |
| 6 | `TestCursorCliSendMessage::test_send_message_to_inbox` | 一个终端向另一个终端的 inbox 发送消息;投递被验证 |
| 7 | `TestCursorCliAllowedTools::test_restricted_supervisor_cannot_bash` | **标记为 `xfail`** —— Cursor CLI 缺少原生 `--disallowedTools` flag;通过 `SECURITY_PROMPT` 的软限制仅是建议性的。追踪见上文"工具限制"。 |
| 8 | `TestCursorCliAllowedTools::test_unrestricted_developer_can_bash` | 带有 `--yolo`(allowedTools=`["*"]`)的 Developer 可以执行 bash |
| 9 | `TestCursorCliAllowedTools::test_allowed_tools_stored_in_metadata` | `allowedTools` 被持久化并由 `GET /terminals/{id}` 返回 |
| 10 | `TestCursorCliSupervisorOrchestration::test_supervisor_handoff` | Supervisor agent 自主调用 `handoff()` MCP 工具委派给 `report_generator` |
| 11 | `TestCursorCliSupervisorOrchestration::test_supervisor_assign_three_analysts` | **规范的 `examples/assign/` 冒烟测试。** Supervisor 并行 assign 3 个数据分析师,串行 handoff 报告生成器,收到全部 3 个 inbox 回调,并完成报告而不亲自做分析工作。Supervisor 必须不能亲自完成这些工作 —— 测试断言最终输出引用了被委派的结果。 |

### 手动 `examples/assign/` 冒烟测试

在 pytest 框架之外做一次快速的交互式验证:

```bash
cao install examples/assign/analysis_supervisor.md --provider cursor_cli
cao install examples/assign/data_analyst.md --provider cursor_cli
cao install examples/assign/report_generator.md --provider cursor_cli

cao launch --agents analysis_supervisor --provider cursor_cli
```

然后在 supervisor 终端里,粘贴来自 `examples/assign/README.md` 的示例任务(3 个数据集,计算均值/中位数/标准差,生成一份报告)。Supervisor 应当:

1. 使用 `assign()` 并行派发 3 个数据分析师
2. 使用 `handoff()` 从报告生成器获取报告模板
3. 结束自己的回合(不要写 sleep/echo 循环 —— 它们会阻塞 inbox 投递)
4. 收到全部 3 个 inbox 回调,把模板 + 结果组合成最终报告

如果 supervisor 亲自完成了分析工作,说明按目录锁或状态检测出了问题 —— 见 `skills/cao-provider/references/lessons-learnt.md` #19(按目录锁)和 #16(alt-screen 检测)。

## 故障排查

### 常见问题

1. **信任对话框阻塞**
   - provider 在 v2026+ **不会**以 `--trust` 启动(Cursor 在交互式 REPL 模式下拒绝该 flag)。CAO 启动流程的工作区信任确认已足够。
   - 如果对话框仍然出现,请验证 `agent`(或 `cursor-agent`)的版本支持 `--force`(`agent --help`)。

2. **MCP 批准对话框阻塞**
   - 当 profile 声明了 `mcpServers` 时,provider 会以 `--approve-mcps` 启动,且 MCP server 被写入 `--plugin-dir` 清单。
   - 如果 MCP server 仍然弹出提示,请检查 `~/.aws/cli-agent-orchestrator/tmp/<tid>-cursor-plugins/` 下的合成 `plugin.json`。

3. **认证问题**
   ```bash
   agent login
   # 或者设置 CURSOR_API_KEY 环境变量
   ```

4. **状态卡在 UNKNOWN**
   - 附加到 tmux 会话(`tmux attach -t <session-name>`)并检查终端输出。
   - 先在普通终端中验证 Cursor CLI 能正常启动:`agent --print "hello"`。
   - 对 v2026+,检测器期望 TUI 已渲染(你应该能看到 `→ Add a follow-up` 占位符以及带 `Composer 2.5 Fast` 的状态栏)。旧版文本模式构建通过 `❯` 提示符 + `─────` 分隔符来分类。

5. **`$PATH` 上找不到 `agent`**
   - provider 不会在命令前加绝对路径 —— 请把二进制安装到你的 shell 能找到的位置。
   - 当两个名字都安装时,provider 优先用 `cursor-agent`;仅当旧别名缺失时才用 `agent`,即便如此也会探测版本横幅以确认解析到的二进制是 Cursor CLI。
   - 在 Linux 上,推荐的安装方式是 `curl https://cursor.com/install -fsS | bash`。

6. **来自 Cursor 后端的 `[invalid_argument] unknown option '--system-prompt'`**
   - 这是一个已确认的 v2026.06.15 后端 bug。provider 刻意省略 `--system-prompt` 以避免它。如果你看到这个错误,说明 agent 很可能是被其他工具启动的(例如直接 `agent --print`)。调查见 issue #299。

7. **E2E 测试以 "Cursor CLI (agent / cursor-agent) not installed" 跳过**
   - 安装 Cursor CLI 并确保 `agent`(或旧版 `cursor-agent`)二进制在 `$PATH` 上。
   - `require_cursor` fixture 在二进制缺失时会自动跳过;不算失败,只是没有覆盖。

## 参考

- [Cursor CLI Overview](https://cursor.com/docs/cli/overview)
- [Cursor CLI Parameters](https://cursor.com/docs/cli/reference/parameters)
- [Issue #264: Add support for Cursor CLI as a provider](https://github.com/awslabs/cli-agent-orchestrator/issues/264)
