# Skills(技能)

## 概述

Skills 是可复用的指令内容块——领域知识、约定、流程、指南——可以跨 agent profile 共享。与其在每个需要这些指令的 agent profile 中重复同样的内容,不如将知识一次性定义为 skill,然后从任意 profile 中引用它。

Skills 采用懒加载:启动时只会把 skill 名称和描述注入到 agent 的 prompt 中。完整内容会在 agent 判断需要时按需获取,从而节省上下文窗口预算。

全局 skill 存储目录位于 `~/.aws/cli-agent-orchestrator/skills/`。内置 skill 和用户自建 skill 之间没有区别——你可以编辑、替换或删除任何 skill,包括默认的那些。除全局存储外,CAO 还可以从你注册的额外目录中发现 skills(例如某个项目自有的 skills 目录)——见下文的[额外 Skill 目录](#额外-skill-目录)。

## 何时使用 Skills

在以下场景使用 skills:

- **多个 agent 需要相同的知识。** 测试约定、编码规范、部署流程或跨多个 agent profile 通用的通信协议。
- **你想让 agent profile 保持聚焦。** Profile 定义 agent *是谁*(角色、工具、MCP server),而 skill 定义 agent *知道如何做什么*。
- **你想节省上下文窗口预算。** 一个执行简单文件重命名操作的 agent,不需要在启动时就加载一份 2000 字的数据库迁移指南。借助 skills,agent 只会在相关时才加载完整内容。
- **你需要组织专属的知识。** 为团队内部工具、代码审查流程或领域特定工作流定制的 skills。

## Skill 文件结构

一个 skill 是一个包含 `SKILL.md` 文件的文件夹。文件夹名必须与 YAML frontmatter 中的 `name` 字段匹配。

```
python-testing/
└── SKILL.md
```

`SKILL.md` 有两个必填的 frontmatter 字段——`name` 和 `description`——后面是 Markdown 格式的 skill 内容:

```markdown
---
name: python-testing
description: Python testing conventions using pytest, fixtures, and coverage requirements
---

# Python Testing Conventions

Use pytest for all test files. Place tests in a `test/` directory mirroring
the `src/` structure...
```

`description` 是 agent 启动时用于判断是否加载该 skill 的内容。把它写得足够详尽,以便 agent 能据此做出判断。

## CLI 命令

### `cao skills list`

列出所有已安装 skill 的名称和描述。

```
$ cao skills list
Name                        Description
cao-supervisor-protocols    Supervisor-side orchestration patterns for assign, handoff, and idle inbox delivery in CAO
cao-worker-protocols        Worker-side callback and completion rules for assigned and handed-off tasks in CAO
```

### `cao skills add <folder-path> [--force]`

从本地文件夹将一个 skill 安装到 skill 存储中。

```bash
# 安装一个新 skill
cao skills add ./python-testing

# 覆盖已存在的 skill
cao skills add ./python-testing --force
```

校验检查(按顺序):
1. 路径是一个目录
2. 目录中包含 `SKILL.md` 文件
3. frontmatter 中有非空的 `name` 和 `description`
4. 文件夹名与 frontmatter 的 `name` 匹配
5. 名称中没有路径穿越字符(`/`、`\`、`..`)
6. skill 尚未存在(除非传入了 `--force`)

安装完成后,所有 provider 都会自动感知这个新 skill——Copilot CLI 的 agent 文件会立即刷新,其他 provider 则在下一次创建终端时感知到变更。

### `cao skills remove <name>`

从 skill 存储中移除一个已安装的 skill。

```bash
cao skills remove python-testing
```

移除后,所有 provider 都会自动感知这一变更——Copilot CLI 的 agent 文件会立即刷新,其他 provider 则在下一次创建终端时感知到变更。

### 内置 skill 自动植入

内置 skill 在 `cao-server` 启动时会自动植入——无需手动步骤。如果同名 skill 已存在,则会被跳过,以保留你已做的任何编辑。CAO 升级后,重启服务会植入新增的内置 skill,但不会覆盖你的修改。你也可以手动运行 `cao init` 来植入。

CAO 内置两个 skill:

| Skill | 描述 |
|-------|------|
| `cao-supervisor-protocols` | 主管(supervisor)的多 agent 编排模式:`assign`、`handoff`、基于空闲状态的消息投递 |
| `cao-worker-protocols` | worker 侧针对被分配和被交接任务的回调与完成规则 |

## 额外 Skill 目录

除全局存储外,CAO 还可以通过 `extra_skill_dirs` 设置从你注册的额外目录中发现 skills。这与 agent profile 的 `extra_agent_dirs` 机制类似。

与 `cao skills add`(将 skill 文件夹**复制**进全局存储)不同,额外目录是**就地扫描**的——不复制任何东西。这让你可以把项目的 skills 保留在项目仓库里(例如 `<repo>/.cao/skills`),然后注册该目录,使 skills 在其源代码位置保持权威:编辑会在下一次创建终端时生效,无需维护第二份副本,skills 也随项目一起纳入版本控制,而不必每次改动后重新添加。

每个已注册目录都会被扫描一层——任何包含 `SKILL.md` 的直接子文件夹都会被视为一个 skill,不包含该文件的子文件夹会被忽略。因此,一个已注册的路径可以是较宽的项目根目录;只有其中的 skill 子文件夹会被纳入。

**解析顺序。** 先搜索全局存储,然后按配置顺序搜索 `extra_skill_dirs`。对给定名称,第一个*有效*匹配胜出,因此全局存储中的 skill 不会被后续额外目录中的同名 skill 遮蔽,而无效(无法加载)的文件夹也不会遮蔽后续同名有效文件夹——`cao skills list` 和 `load_skill` 会把同一个名称解析到同一个 skill。

**配置。** 额外 skill 目录存储在 `~/.aws/cli-agent-orchestrator/settings.json` 的 `extra_skill_dirs` 下,并通过 `/settings/skill-dirs` API 管理。请求/响应格式见 [settings.md](./settings.md#skill-directories)。

## Agent 如何发现 Skills

所有已安装的 skill 都对所有 CAO agent 可用——没有针对 profile 的 skill 声明。启动一个 agent 时,CAO 会向 prompt 追加一个目录块,列出每个已安装 skill 的名称和描述,并附带使用 `load_skill` MCP 工具获取完整内容的说明。随后 agent 会根据手头任务决定何时以及是否加载各个 skill。

你可以在 agent profile 正文中显式指示 agent 预先加载特定 skills:

```markdown
Before starting any task, load the python-testing and code-style skills.
```

## 各 Provider 下 Skills 的工作方式

skill 投递给 agent 的方式因 provider 而异。下表汇总了各 provider 的机制:

| Provider | 注入方式 | 目录更新时机 | Skill 获取 |
|----------|----------|--------------|-----------|
| Claude Code | 运行时 prompt | 每次创建终端 | `load_skill` MCP 工具 |
| Codex | 运行时 prompt | 每次创建终端 | `load_skill` MCP 工具 |
| Gemini CLI | 运行时 prompt | 每次创建终端 | `load_skill` MCP 工具 |
| Kimi CLI | 运行时 prompt | 每次创建终端 | `load_skill` MCP 工具 |
| Kiro CLI | 原生 `skill://` 资源 | 每次创建终端 | Kiro 渐进式加载 |
| Copilot CLI | 安装时写入 `.agent.md` | 执行 `cao skills add/remove` 时 | `load_skill` MCP 工具 |

### 运行时 Prompt 类 Provider(Claude Code、Codex、Gemini CLI、Kimi CLI)

对这些 provider,每次创建终端时都会重新构建 skill 目录。这个目录——一份 skill 名称和描述的列表——通过 provider 原生的 CLI flag 被追加到 system prompt 中。

agent 在运行时通过调用 `load_skill` MCP 工具获取完整 skill 内容,该工具会从 CAO 服务获取 skill 正文。

执行 `cao skills add` 或 `cao skills remove` 后无需任何操作——下一次创建的终端会自动反映当前已安装的 skill 集合。

### Kiro CLI

Kiro 原生支持带有渐进式加载的 `skill://` 资源。创建终端时,CAO 会在 agent 的 `resources` 字段中加入一个指向 skill 存储目录的 `skill://` glob 模式:

```
skill://~/.aws/cli-agent-orchestrator/skills/**/SKILL.md
```

Kiro 在启动时只加载 skill 元数据(名称和描述),然后通过其自身的渐进式加载机制按需获取完整内容——无需调用 MCP 工具。

由于 Kiro 直接从 skill 存储读取,`cao skills add` 或 `cao skills remove` 的变更会在下一次创建终端时生效。无需刷新 agent 文件。

### Copilot CLI

skill 目录在安装时被写入 agent 的 `.agent.md` 文件(`~/.copilot/agents/{name}.agent.md`)。该文件的 Markdown 正文包含 agent 的 prompt,其后追加了 skill 目录。刷新时会保留 YAML frontmatter(`name`、`description`)。

当你运行 `cao skills add` 或 `cao skills remove` 时,所有 CAO 管理的 Copilot agent 文件会自动刷新——其正文内容会用更新后的 skill 目录重写,同时保留 frontmatter。

CAO 通过检查 `~/.aws/cli-agent-orchestrator/agent-context/` 中是否存在匹配的 agent 上下文文件,来识别由它管理的 Copilot agent。

## 创建自定义 Skill

1. 创建一个以你的 skill 名称命名的文件夹:

```bash
mkdir my-coding-standards
```

2. 在其中创建一个 `SKILL.md` 文件:

```markdown
---
name: my-coding-standards
description: Team coding standards for Python services including naming, error handling, and logging
---

# Coding Standards

## Naming Conventions

- Use snake_case for functions and variables
- Use PascalCase for classes
...
```

3. 安装该 skill:

```bash
cao skills add ./my-coding-standards
```

安装完成后,该 skill 会自动对所有 CAO agent 可用。`cao skills add` 命令会立即刷新 Copilot CLI 的 agent 文件。所有其他 provider 则在下一次创建终端时感知到变更。

## 更新 Skill

你可以直接在 skill 存储中编辑某个 skill:

```bash
vim ~/.aws/cli-agent-orchestrator/skills/my-coding-standards/SKILL.md
```

或者用本地文件夹中的更新版本覆盖它:

```bash
cao skills add ./my-coding-standards --force
```

运行 `cao skills add --force` 会立即刷新 Copilot CLI 的 agent 文件。所有其他 provider 则在下一次创建终端时感知到变更。如果你是直接在存储中编辑 skill 文件,而不是使用 `cao skills add --force`,则 Copilot 文件不会被刷新——请运行 `cao skills remove <name>` 后再 `cao skills add <folder>` 来触发刷新,或用 `cao install` 重新安装受影响的 agent。

## 已知限制

- **不支持嵌套的 skill 目录。** Skills 必须是 skill 存储的直接子目录。嵌套路径(例如 `skills/team/python-testing/`)不会被 CAO 的 skill 目录发现。Kiro 的 `skill://` glob 原生支持嵌套路径,但其他 provider 不支持。
- **没有针对 profile 的 skill 作用域。** 所有已安装 skill 都对所有 agent 可用。目前没有机制限制某个特定 agent profile 能看到哪些 skills。计划在未来加入 agent profile frontmatter 中的 `skills` 字段,用于声明允许使用的 skills。
