# 工具限制

## 概念概览

CAO 通过一个两层系统来控制 agent 可以使用哪些工具:

```
                ┌─────────────────────────────────┐
  高层          │           role                   │  "这是哪种 agent?"
                │   supervisor, developer, ...     │  一个命名好的 allowedTools 集合
                └──────────────┬──────────────────┘
                               │ 映射到
                ┌──────────────▼──────────────────┐
  低层          │        allowedTools              │  "这个 agent 能用哪些工具?"
                │  execute_bash, fs_read, ...      │  细粒度的工具列表
                └─────────────────────────────────┘
```

- **`role`** —— 高层抽象。一个命名的预设,映射到一组默认的 `allowedTools`。可以把它理解成 "这是哪种 agent?"。CAO 内置了一批角色,用户也可以自定义角色。
- **`allowedTools`** —— 低层控制。一个显式的工具列表,指定 agent 可以使用哪些工具。一旦设置,总是覆盖 `role`。
- **`--yolo`** —— 逃生舱。绕过所有限制并跳过确认提示。agent 可以做任何事情。

## 默认行为

**如果你没有设置 `role` 或 `allowedTools`,agent 会默认使用 `developer` 角色的权限**(`@builtin`、`fs_*`、`execute_bash`、`web_fetch`、`@cao-mcp-server`)。这提供了完整的编码访问能力,同时仍然会经过限制系统。启动确认提示会提醒你为 profile 添加 `role` 或 `allowedTools`。

## 三种控制方式

### 1. `role` —— 简单方式

在 agent profile 的 frontmatter 中设置 `role`。CAO 会自动把它映射到一组合理的 `allowedTools`。

```yaml
---
name: code_supervisor
description: Orchestrates worker agents
role: supervisor
---
```

#### 内置角色

| Role | 默认的 `allowedTools` | agent 能做什么 |
|------|----------------------|----------------------|
| `supervisor` | `@cao-mcp-server`、`fs_read`、`fs_list` | 编排 worker 并读取文件作为上下文 |
| `developer` | `@builtin`、`fs_*`、`execute_bash`、`web_fetch`、`@cao-mcp-server` | 完整访问:读、写、执行、抓取、编排 |
| `reviewer` | `@builtin`、`fs_read`、`fs_list`、`@cao-mcp-server` | 只读:审查代码,不能写、执行或联网 |

#### 自定义角色

在 `~/.aws/cli-agent-orchestrator/settings.json` 中定义你自己的角色:

```json
{
  "roles": {
    "data_analyst": ["fs_read", "execute_bash", "@cao-mcp-server"],
    "secure_dev": ["fs_read", "fs_write", "@cao-mcp-server"]
  }
}
```

然后在任意 profile 中使用:

```yaml
---
name: my_analyst
role: data_analyst
---
```

自定义角色遵循与内置角色相同的规则 —— 它们只是一个命名的 `allowedTools` 列表。

### 2. `allowedTools` —— 精确方式

直接在 profile 的 frontmatter 中设置 `allowedTools` 以进行细粒度控制。它总是会覆盖 `role`,并且**可以在不设置 `role` 的情况下单独使用**。

```yaml
---
name: restricted_developer
description: Developer with no bash access
role: developer
allowedTools: ["@builtin", "fs_*", "@cao-mcp-server"]
---
```

在这个例子中,`role: developer` 通常会包含 `execute_bash`,但 `allowedTools` 显式地排除了它。显式列表优先。

你也可以在不带 `role` 的情况下使用 `allowedTools`:

```yaml
---
name: read_only_agent
description: Agent with only read and bash access
allowedTools: ["fs_read", "fs_list", "execute_bash"]
---
```

不需要 `role` —— `allowedTools` 就是 agent 能用哪些工具的完整规范。

#### 工具词汇表

| Tool | 允许做什么 | Example: Claude Code | Example: Gemini CLI |
|------|---------------|---------------------|-------------------|
| `execute_bash` | 运行 shell 命令 | `Bash` | `run_shell_command` |
| `fs_read` | 读取文件 | `Read` | `read_file` |
| `fs_write` | 写入/编辑文件 | `Edit`、`Write` | `write_file`、`replace` |
| `fs_list` | 搜索/列出文件 | `Glob`、`Grep` | `list_directory`、`glob` |
| `fs_*` | 所有文件系统操作 | 上述全部 | 上述全部 |
| `web_fetch` | 抓取 URL / 搜索网络 | `WebFetch`、`WebSearch` | `web_fetch`、`google_web_search` |
| `@builtin` | provider 内置能力 | (内部) | (内部) |
| `@cao-mcp-server` | CAO 编排工具 | `handoff`、`assign`、`send_message`,以及通过 `answer_user_prompt` 回答 Hermes 提示 | 同上 |
| `*` | 一切(不受限) | 所有工具 | 所有工具 |

CAO 会自动把这些翻译成各 provider 的原生工具名。你只需写一套词汇,就能在所有受支持的 provider 上工作。

### 3. `--yolo` —— 逃生舱

```bash
cao launch --agents code_supervisor --yolo
```

`--yolo` 做两件事:
1. 设置 `allowedTools: ["*"]` —— agent 可以使用所有工具
2. 跳过确认提示 —— 在显示一条警告后立即启动

**当你想要零限制时使用 `--yolo`。** 它会覆盖一切 —— role、allowedTools、CLI 标志。agent 可以执行任何命令:`aws`、`rm -rf`、`curl`、读取凭据,任何事。

系统仍会显示一条警告,让你清楚正在发生什么:

```
[WARNING] --yolo mode enabled
  Agent 'code_supervisor' launching UNRESTRICTED on claude_code.
  Agent can execute ANY command (aws, rm, curl, read credentials).
  Directory: /home/user/my-project
```

## 启动确认提示

当你在没有 `--yolo` 或 `--auto-approve` 的情况下运行 `cao launch` 时,CAO 会显示已解析的工具限制摘要,并请求确认:

```
Agent 'code_supervisor' launching on kiro_cli:
  Role:      supervisor
  Allowed:   @cao-mcp-server, fs_read, fs_list
  Directory: /home/user/my-project

  To skip this prompt next time, relaunch with --auto-approve
  To remove all restrictions, relaunch with --yolo

Proceed? [Y/n]
```

如果 profile 中没有设置 `role` 或 `allowedTools`,提示中会包含一条额外的提醒:

```
Agent 'my_agent' launching on claude_code:
  Role:      (not set — using developer defaults)
  Allowed:   @builtin, fs_*, execute_bash, web_fetch, @cao-mcp-server
  Directory: /home/user/my-project

  Note: No role or allowedTools set — defaulting to 'developer'.
  Add 'role' or 'allowedTools' to your agent profile to control tool access.
  Docs: https://github.com/awslabs/cli-agent-orchestrator/blob/main/docs/tool-restrictions.md

  To skip this prompt next time, relaunch with --auto-approve
  To remove all restrictions, relaunch with --yolo

Proceed? [Y/n]
```

### `--auto-approve` 与 `--yolo`

| | 在提示处输入 `Y` | `--auto-approve` | `--yolo` |
|---|---|---|---|
| **确认提示** | 显示 | 跳过 | 跳过 |
| **工具限制** | 强制执行 | 强制执行 | 移除 —— `["*"]` |
| **适用场景** | 交互式启动 | 自动化流程、脚本、agent 之间 | 不受限制的访问 |

```bash
cao launch --agents my_agent                  # 交互式 —— 显示提示
cao launch --agents my_agent --auto-approve   # 自动化 —— 跳过提示,保留限制
cao launch --agents my_agent --yolo           # 不受限制 —— 跳过提示并移除限制
```

确认提示是一道**审查关卡** —— 它会显示已解析的 role 和允许使用的工具,然后让你选择继续或取消。`--auto-approve` 会跳过这道关卡,同时保留所有限制 —— 适用于 CAO 流程、脚本化启动以及 agent 之间的工作流。`--yolo` 位于覆盖层级的最顶端 —— 它**会同时覆盖 role 和 allowedTools**,授予不受限制的访问权限(`["*"]`),并完全跳过提示。

### 工具限制如何被强制执行(实现细节)

CAO 定义了一套通用的工具词汇表(`execute_bash`、`fs_read`、`fs_write`、`fs_list`)。然而,并非所有 provider 都原生理解这套词汇表。分为两类:

**需要翻译的 provider** —— Claude Code、Copilot CLI 和 Gemini CLI 各自有自己的原生工具名(例如,Claude Code 把 bash 执行叫作 `Bash`,Copilot 把它叫作 `shell`)。CAO 使用一个内部的 `TOOL_MAPPING` 把 CAO 词汇表翻译成 provider 原生名,然后计算出需要屏蔽哪些原生工具,并以 CLI 标志的形式传入(例如 `--disallowedTools Bash`、`--deny-tool shell`)。

| CAO Tool | Claude Code | Copilot CLI | Gemini CLI |
|----------|-------------|-------------|------------|
| `execute_bash` | `Bash` | `shell` | `run_shell_command` |
| `fs_read` | `Read` | `read` | `read_file`、`list_directory`、`search_file_content`、`glob` |
| `fs_write` | `Edit`、`Write` | `write` | `write_file`、`replace` |
| `fs_list` | `Glob`、`Grep` | `list`、`grep` | `list_directory`、`glob`、`search_file_content` |
| `web_fetch` | `WebFetch`、`WebSearch` | (未映射) | `web_fetch`、`google_web_search` |

**直接接受 CAO 词汇表的 provider** —— Kiro CLI 和 Q CLI 在安装时接受 agent JSON 中的 `allowedTools`,使用与 CAO 相同的词汇表,无需翻译。Kimi CLI 和 Codex 则通过系统提示指令来强制执行限制。对于这四种,CAO 都会直接传入 `allowedTools` 列表而无需翻译 —— 因此它们既不存在、也不需要 `TOOL_MAPPING` 条目。

## 覆盖规则如何工作

当多个控制项同时设置时,优先级最高的胜出:

```
优先级(从高到低):

  1. --yolo                    → ["*"](不受限,无提示)
  2. --allowed-tools CLI 标志   → 启动时的显式列表
  3. profile 中的 allowedTools  → frontmatter 中的显式列表
  4. profile 中的 role          → 映射到内置/自定义角色默认值
  5. (未设置任何内容)           → developer 默认值
```

注意:`--auto-approve` **不在**这条优先级链中 —— 它只控制是否显示确认提示,不影响应用哪些限制。

示例:

```bash
# Profile 中有 role: supervisor → 限制为 @cao-mcp-server + fs_read + fs_list
cao launch --agents code_supervisor

# 同上,但跳过确认提示(限制仍被强制执行)
cao launch --agents code_supervisor --auto-approve

# CLI 标志覆盖 role
cao launch --agents code_supervisor --allowed-tools execute_bash --allowed-tools fs_read

# --yolo 覆盖一切
cao launch --agents code_supervisor --yolo
```

## Provider 的强制执行方式

如[工具限制如何被强制执行](#how-tool-restrictions-are-enforced-implementation-detail)所述,某些 provider 需要 CAO 把 `allowedTools` 翻译成原生工具名(通过 `TOOL_MAPPING`),而另一些则直接接受 CAO 词汇表。下表展示了各 provider 如何强制执行限制:

| Provider | 强制执行方式 | 工作原理 |
|----------|------------|-------------|
| **Claude Code** | 硬性 | `--disallowedTools` 标志屏蔽特定工具 |
| **Kiro CLI** | 硬性 | 安装时写入 agent JSON 的 `allowedTools` |
| **Q CLI** | 硬性 | 安装时写入 agent JSON 的 `allowedTools` |
| **Copilot CLI** | 硬性 | `--deny-tool` 标志覆盖 `--allow-all` |
| **Gemini CLI** | 硬性 | `~/.gemini/policies/` 中的 Policy Engine TOML 拒绝规则 |
| **Kimi CLI** | 软性 | 仅靠安全系统提示 |
| **Codex** | 软性 | 仅靠安全系统提示 |
| **Hermes** | 由 profile 定义 | CAO 启动默认的 `hermes`,或由 CAO profile 声明的可选 `hermesProfile` 包装器;在该 Hermes profile 中限制工具 |

**硬性强制执行** = agent 在物理上无法使用被拒绝的工具,由 provider 运行时强制保证。

**软性强制执行** = 通过系统提示告诉 agent 不要使用某些工具。agent 仍可能尝试使用它们。对安全关键型工作,请使用硬性强制执行的 provider。

### 各 provider 的 "硬性" 具体表现

**Claude Code** —— 在启动命令中添加 `--disallowedTools` 标志:
```bash
claude --dangerously-skip-permissions --disallowedTools Bash --disallowedTools Edit --disallowedTools Write
```

`permissionMode` 是独立于 `--disallowedTools` 的另一条轴线:`permissionMode` 控制会话运行在哪个权限层级(无条件绕过还是 `auto` 这类分类器把关的层级),而 `--disallowedTools` 强制执行针对单个工具的黑名单。二者可以叠加 —— 一个 profile 可以同时设置 `permissionMode: auto` *和* 一个工具黑名单,两者都会体现在启动命令上。完整细节见 [Permission Mode Override](claude-code.md#permission-mode-override)。

**Kiro CLI / Q CLI** —— 在安装时把 `allowedTools` 写入 agent JSON:
```json
{ "allowedTools": ["@cao-mcp-server", "fs_read", "fs_list"] }
```

**Copilot CLI** —— 添加 `--deny-tool` 标志来覆盖 `--allow-all`:
```bash
copilot --allow-all --deny-tool shell --deny-tool write
```

**Gemini CLI** —— 为每个会话向 `~/.gemini/policies/` 写入 TOML 拒绝规则:
```toml
[[rule]]
toolName = "run_shell_command"
decision = "deny"
priority = 900
```

**Kimi CLI / Codex** —— 在系统提示开头加入:
```
You may ONLY use these tools: @cao-mcp-server, fs_read, fs_list
Do NOT attempt to use: execute_bash, fs_write
```

## 跨 Provider 继承

当 supervisor 通过 `handoff()` 或 `assign()` 委派任务时,子 agent 会从自己的 profile 中解析出自己的 `allowedTools` —— 不会从父 agent 继承。

```
Supervisor (role: supervisor → @cao-mcp-server, fs_read, fs_list)
  │
  ├─ assign("developer")
  │    → Developer profile: role: developer → 完整访问
  │    → Claude Code 启动时不带 --disallowedTools
  │
  └─ handoff("reviewer")
       → Reviewer profile: role: reviewer → 只读
       → Claude Code 启动时带 --disallowedTools Bash Edit Write
```

每个 agent 都根据它自己的 profile 受到限制,而不是其父 agent 的权限。

## 快速参考

| 我想要... | 这样做 |
|-------------|---------|
| 把 supervisor 限制为编排 + 读取 | `role: supervisor` |
| 给 developer 完整访问权限 | `role: developer`(或什么都不设) |
| 只读的 reviewer | `role: reviewer` |
| 自定义工具集 | `allowedTools: ["fs_read", "execute_bash"]` |
| 可复用的自定义预设 | 在 `settings.json` 的 `roles` 中定义,然后使用 `role: my_preset` |
| 启动时覆盖 role | `--allowed-tools fs_read --allowed-tools @cao-mcp-server` |
| 在脚本/自动化中跳过确认 | `--auto-approve`(限制仍被强制执行) |
| 完全不受限制 | `--yolo` |
| 启动前检查允许的内容 | 不带 `--yolo` 或 `--auto-approve` 启动 —— 提示会显示摘要 |

## 安全建议

1. **为编排器使用 `role: supervisor`。** 它们只需要 MCP 工具 + 读取文件作为上下文。
2. **不要在生产环境使用 `--yolo`。** 它会授予不受限制的访问权限并跳过所有安全提示。
3. **对敏感工作负载优先使用硬性强制执行的 provider**(Claude Code、Kiro CLI、Q CLI、Copilot CLI、Gemini CLI)。
4. **审查确认提示。** 它会在你继续之前准确显示哪些工具被允许、哪些被屏蔽。
5. **Kimi CLI 和 Codex 使用软性强制执行** —— 仅用于非关键任务。

## 已知限制

1. **Claude Code 的工具映射已基本完整,MCP 工具是剩余的缺口。** 当前映射覆盖了 `Bash`(及其 `Task`/`Monitor`/`BashOutput`/`KillShell` 执行家族)、`Read`、`Edit`、`Write`、`Glob`、`Grep`,以及 —— 通过 `web_fetch` —— [`WebFetch`](https://code.claude.com/docs/en/permissions#webfetch) 和 `WebSearch`。subagent 工具(`Task`)被刻意**不**单列一类:它被并入 `execute_bash`,因为一个 `Task` subagent 会带着自己的完整工具集启动并能运行 shell,若把它单独暴露,就会让一个 profile 在不授予 `execute_bash` 的情况下授予 subagent 访问,从而重新打开这个逃生口。provider 的 MCP 工具仍未被映射(见限制 #2)—— 它们无法通过 `--disallowedTools` 屏蔽。

2. **`@cao-mcp-server` 是一个透传标记,不在 provider 层强制执行。** 在 `allowedTools` 中包含 `@cao-mcp-server` 表达了意图(这个 agent 应该拥有编排工具),但它**不会**翻译成任何原生的 `--disallowedTools` 标志。MCP 工具(`handoff`、`assign`、`send_message`、`answer_user_prompt`)无论 `allowedTools` 如何设置,都对 agent 始终可用 —— provider 目前不支持屏蔽单个 MCP 工具。`answer_user_prompt` 由 MCP server 暴露,但其结构化提示导航行为目前仅为报告 `waiting_user_answer` 的 Hermes worker 实现;其他 provider 在实现等效的提示状态之前,可能只会收到普通文本输入。此外,`@cao-mcp-server` 是全有或全无的:没有办法只允许 `send_message` 而屏蔽 `assign`。未来版本可能会支持 `@cao-mcp-server:send_message` 语法,用于逐工具的 MCP 控制。

3. **软性强制执行是尽力而为的。** Kimi CLI 和 Codex 依靠系统提示指令来限制工具。agent 可能会忽略这些限制。不要在安全关键型工作负载上依赖软性强制执行。

## 示例 Profile

关于 `role` 和 `allowedTools` 的完整可运行示例,见 [examples 目录](../../examples/):

- **[assign/](../../examples/assign/)** —— 带有基于角色限制的 Supervisor + worker agent
- **[cross-provider/](../../examples/cross-provider/)** —— 带有逐 agent 工具限制的混合 provider 工作流
- **[codex-basic/](../../examples/codex-basic/)** —— 带有软性强制执行的 Codex agent
