# 记忆系统

CAO 的记忆系统为 agent 提供跨会话的持久化存储。Agent 在会话期间可以存储事实、决策和偏好;当 agent 在下一次会话启动时,CAO 会把相关记忆作为上下文注入回去。

## 工作原理

1. **Agent 存储记忆**:在会话期间通过 `memory_store` MCP 工具
2. **CAO 持久化**:以 markdown wiki 文件形式保存到 `~/.aws/cli-agent-orchestrator/memory/`
3. **下次会话启动时**:CAO 在 agent 的第一条消息之前,把匹配的记忆作为 `<cao-memory>` 上下文块注入
4. **Agent 回忆**:需要显式查找时使用 `memory_recall`

## 记忆作用域

作用域控制记忆存储在哪里、谁能读取。

| 作用域 | 存储位置 | 适用场景 |
|---|---|---|
| `global` | `memory/global/wiki/global/` | 跨项目事实:用户偏好、编码规范 |
| `project` | `memory/{cwd_hash}/wiki/project/` | 项目特定内容:架构决策、约定 |
| `session` | `memory/global/wiki/session/` | 临时内容:仅当前会话的笔记 |
| `agent` | `memory/global/wiki/agent/` | 角色特定内容:该 agent 角色总是应用的模式 |

`project` 是默认作用域。项目哈希为 `sha256(realpath(cwd))[:12]`。

> **注意:**`session` 和 `agent` 作用域存储在 global 容器下,而不是各自独立的顶层目录。只有 `project` 作用域拥有按项目哈希索引的专用目录。

## 记忆类型

类型是一个分类标签,不影响存储位置。

| 类型 | 用途 |
|---|---|
| `project` | 架构笔记、项目约定(默认) |
| `user` | 用户偏好、工作风格 |
| `feedback` | 纠正、需要避免的反复出现的错误 |
| `reference` | 指向外部资源、文档、链接的指引 |

## MCP 工具

Agent 通过 `cao-mcp-server` MCP 服务器使用这些工具。

### `memory_store`

存储或更新一条记忆。如果 key 已存在,新内容会作为带时间戳的条目追加(upsert)。

```
memory_store(
  content="Always use pytest for testing in this project",
  scope="project",          # optional, default: "project"
  memory_type="feedback",   # optional, default: "project"
  key="testing-framework",  # optional, auto-generated from content if omitted
  tags="testing,pytest"     # optional
)
```

### `memory_recall`

通过关键词查询和可选过滤器搜索记忆。

```
memory_recall(
  query="testing",     # optional, searches content
  scope="project",     # optional, filter by scope
  memory_type=None,    # optional, filter by type
  limit=10             # optional, default 10, max 100
)
```

结果按时间倒序返回,作用域优先级为:`session` > `project` > `global`。

### `memory_forget`

按 key 删除记忆。

```
memory_forget(
  key="testing-framework",
  scope="project"
)
```

## CLI 命令

```bash
# List memories (shows global + current project by default)
cao memory list
cao memory list --all              # all projects
cao memory list --scope global
cao memory list --type feedback

# Show full content of a memory
cao memory show <key>
cao memory show <key> --scope global

# Delete a memory
cao memory delete <key>
cao memory delete <key> --scope project --yes

# Clear all memories for a scope
cao memory clear --scope session --yes
```

## 上下文注入

当 agent 在会话中收到第一条消息时,CAO 会在消息前面插入一个 `<cao-memory>` 块,包含相关记忆(最多 3000 字符)。块格式如下:

```
<cao-memory>
## Context from CAO Memory
- [session] recent-decision: Use the existing auth middleware, do not rewrite
- [project] testing-framework: Always use pytest for testing in this project
- [global] user-prefers-concise: User prefers concise responses without trailing summaries
</cao-memory>

<original user message>
```

记忆按作用域优先级顺序选取:`session` > `project` > `global`。

## 自动保存

第一阶段没有自动保存钩子。Agent 想要持久化某条事实时,必须通过 MCP 显式调用 `memory_store`。Agent profile 中包含关于何时存储的指引。由钩子驱动的自动保存将在后续 PR 中通过各 provider 插件提供。

## 存储布局

```
~/.aws/cli-agent-orchestrator/memory/
├── global/
│   └── wiki/
│       ├── index.md              # index of all global/session/agent memories
│       ├── global/
│       │   └── {key}.md
│       ├── session/
│       │   └── {session_name}/
│       │       └── {key}.md
│       └── agent/
│           └── {agent_profile}/
│               └── {key}.md
└── {cwd_hash}/                   # e.g. 14ae6bda7bac
    └── wiki/
        ├── index.md              # index of this project's memories
        └── project/
            └── {key}.md
```

每个 wiki 文件是一个 markdown 文档,带有类 YAML 的注释头部和带时间戳的条目:

```markdown
# testing-framework
<!-- id: abc123 | scope: project | type: feedback | tags: testing,pytest -->

## 2026-04-16T10:30:00Z
Always use pytest for testing in this project. Do not use unittest.
```

## 保留期

保留期以**作用域**为键,对记忆类型有一个例外:

| 作用域 | 保留期 |
|---|---|
| `global` | 永不过期 |
| `project` | 自上次更新起 90 天 |
| `session` | 14 天 |
| `agent` | 永不过期 |

`memory_type` 为 `user` 或 `feedback` 的记忆属于运维策展知识,无论作用域如何都永不过期。

清理工作在 `cao-server` 启动时自动在后台运行。

## 在 Agent Profile 中添加记忆指令

在 agent 的系统提示词中添加一个 `## Memory` 小节:

```markdown
## Memory

When you discover something worth remembering — user preferences, project conventions,
important decisions, recurring corrections — store it immediately using the `memory_store`
CAO tool. Keep each memory to 1–2 sentences. Store decisions and conclusions, not conversation.
Use `memory_recall` to check if you already know something before asking the user.

Note: `memory_store` and `memory_recall` are CAO's cross-provider memory tools, distinct from
any provider-native memory system.
```
