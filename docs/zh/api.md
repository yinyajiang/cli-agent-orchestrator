# CLI Agent Orchestrator API 文档

基础 URL:`http://localhost:9889`(默认)

## 健康检查

### GET /health
检查服务器是否正在运行。

**响应:**
```json
{
  "status": "ok",
  "service": "cli-agent-orchestrator"
}
```

---

## Providers

### GET /agents/providers
列出可用的 providers 及其安装状态。

**响应:** provider 对象数组
```json
[
  {
    "name": "kiro_cli",
    "binary": "kiro-cli",
    "installed": true
  },
  {
    "name": "claude_code",
    "binary": "claude",
    "installed": true
  },
  {
    "name": "q_cli",
    "binary": "q",
    "installed": false
  },
  {
    "name": "codex",
    "binary": "codex",
    "installed": true
  },
  {
    "name": "gemini_cli",
    "binary": "gemini",
    "installed": true
  },
  {
    "name": "kimi_cli",
    "binary": "kimi",
    "installed": false
  },
  {
    "name": "hermes",
    "binary": "hermes",
    "installed": true
  },
  {
    "name": "copilot_cli",
    "binary": "copilot",
    "installed": false
  }
]
```

**注意:** `installed` 字段通过 `shutil.which()` 检查 provider 二进制文件是否在系统 PATH 中可用。

---

## 会话(Sessions)

### POST /sessions
创建一个带有一个终端的新会话。

**参数:**
- `provider`(字符串,必填):Provider 类型("kiro_cli"、"claude_code"、"codex"、"gemini_cli"、"hermes"、"kimi_cli"、"copilot_cli" 或 "q_cli")
- `agent_profile`(字符串,必填):Agent profile 名称
- `session_name`(字符串,可选):自定义会话名
- `working_directory`(字符串,可选):agent 会话的工作目录

**响应:** Terminal 对象(201 Created)

### GET /sessions
列出所有会话。

**响应:** session 对象数组

### GET /sessions/{session_name}
获取某个特定会话的详情。

**响应:** 包含 terminals 列表的 session 对象

### DELETE /sessions/{session_name}
删除一个会话及其所有终端。

**响应:**
```json
{
  "success": true
}
```

---

## 终端(Terminals)

**注意:** 所有 `terminal_id` 路径参数必须是 8 位十六进制字符串(例如 "a1b2c3d4")。

### POST /sessions/{session_name}/terminals
在已有会话中创建额外的终端。

**参数:**
- `provider`(字符串,必填):Provider 类型
- `agent_profile`(字符串,必填):Agent profile 名称
- `working_directory`(字符串,可选):该终端的工作目录
- `caller_id`(字符串,可选):创建该终端的终端 ID(8 位十六进制)。会被记录下来,以便 `send_message` 在默认情况下把回复发给调用方(issue #284)。

**响应:** Terminal 对象(201 Created)

### GET /sessions/{session_name}/terminals
列出某个会话中的所有终端。

**响应:** terminal 对象数组

### GET /terminals/{terminal_id}
获取终端详情。

**响应:** Terminal 对象
```json
{
  "id": "string",
  "name": "string",
  "provider": "kiro_cli|claude_code|codex|gemini_cli|hermes|kimi_cli|copilot_cli|q_cli",
  "session_name": "string",
  "agent_profile": "string",
  "caller_id": "string|null",
  "status": "idle|processing|completed|waiting_user_answer|error",
  "last_active": "timestamp"
}
```

### POST /terminals/{terminal_id}/input
向终端发送输入。

**参数:**
- `message`(字符串,必填):要发送的消息

**响应:**
```json
{
  "success": true
}
```

### POST /terminals/{terminal_id}/key
向终端发送一个 tmux 按键序列。用于需要非文本按键的交互式提示,例如 Hermes clarify 选择器的导航。

该端点是通用的,但目前代码库内唯一结构化的调用方是 `answer_user_prompt` 的 Hermes 路径。未来当其他 provider 暴露出等价的提示状态或按键导航流程时,也可以使用它。

**参数:**
- `key`(字符串,必填):允许的 tmux 按键名:`Up`、`Down`、`Left`、`Right`、`Enter`、`Tab`、`Escape`、`Space`、单个字母数字键,或一个 `C-`、`M-`、`S-` 修饰组合键,例如 `C-c` 或 `M-x`

**响应:**
```json
{
  "success": true
}
```

### GET /terminals/{terminal_id}/output
获取终端输出。

**参数:**
- `mode`(字符串,可选):输出模式 —— "full"(默认)、"last" 或 "tail"
  - `"full"` 返回 StatusMonitor 的滚动缓冲区(最近约 8KB 的流式输出),而非无上限的回滚历史。长会话会被截断到尾部;若需要完整历史,请使用磁盘上的终端日志。

**响应:**
```json
{
  "output": "string",
  "mode": "string"
}
```

### GET /terminals/{terminal_id}/working-directory
获取某个终端窗格当前的工作目录。

**响应:**
```json
{
  "working_directory": "/home/user/project"
}
```

**注意:** 当工作目录不可用时返回 `null`。

### POST /terminals/{terminal_id}/exit
向终端发送 provider 专属的退出命令。

**行为:**
- 调用 provider 的 `exit_cli()` 方法获取退出命令
- 文本命令(例如 `/exit`、`quit`)会通过 `send_input()` 以字面文本形式发送
- 以 `C-` 或 `M-` 为前缀的按键序列(例如代表 Ctrl+D 的 `C-d`)会通过 `send_special_key()` 作为 tmux 按键序列发送,由 tmux 解释为真实的按键

| Provider | 退出命令 | 类型 |
|----------|-------------|------|
| kiro_cli | `/exit` | Text |
| claude_code | `/exit` | Text |
| codex | `/exit` | Text |
| gemini_cli | `/exit` | Text |
| hermes | `/exit` | Text |
| kimi_cli | `/exit` | Text |
| copilot_cli | `/exit` | Text |
| q_cli | `/exit` | Text |

**响应:**
```json
{
  "success": true
}
```

### DELETE /terminals/{terminal_id}
删除一个终端。

**响应:**
```json
{
  "success": true
}
```

---

## Inbox(终端到终端的消息传递)

### POST /terminals/{receiver_id}/inbox/messages
向另一个终端的 inbox 发送消息。

**参数:**
- `sender_id`(字符串,必填):发送方终端 ID
- `message`(字符串,必填):消息内容

**响应:**
```json
{
  "success": true,
  "message_id": "string",
  "sender_id": "string",
  "receiver_id": "string",
  "created_at": "timestamp"
}
```

**行为:**
- 消息会被排队,并在接收终端处于 IDLE 状态时投递
- 消息按顺序投递(最旧的优先)
- 投递由事件驱动的状态检测自动完成

---

## Memory

`cao memory` CLI 的 REST 镜像。当 settings.json 中的 `memory.enabled` 为 false 时,所有 `/memory` 端点都会返回 `404` 和 `"Memory system is disabled"`;可使用 `GET /settings/memory` 来探测启用状态(例如用于隐藏 UI)。

key 必须匹配 `^[a-z0-9-]{1,60}$`,`scope_id` 必须匹配 `^[a-zA-Z0-9._-]{1,128}$`;格式不正确的值会返回 `422`。

由于服务器的工作目录并非用户的项目目录,project 作用域通过显式的 `scope_id` 查询参数(即解析后的项目 ID)来定位。这一点有意与 MCP 的 `memory_forget` 工具不同 —— 后者会从调用终端解析上下文。

已知不一致之处:内部的 `GET /terminals/{id}/memory-context` 端点早于这套约定,当 memory 被禁用时会返回空的 `200`(而非 `404`)。

### GET /settings/memory
返回 memory 子系统是否启用。

**响应:**
```json
{
  "enabled": true
}
```

### GET /memory
列出所有项目中存储的 memories(对应 CLI 的 `cao memory list --all`)。

**参数:**
- `scope`(字符串,可选):按作用域过滤(`global`、`project`、`session`、`agent`)
- `type`(字符串,可选):按 memory 类型过滤(`user`、`feedback`、`project`、`reference`)
- `scope_id`(字符串,可选):过滤到某个具体 project/session/agent
- `limit`(整数,可选):最大结果数,1–100(默认:50)

**响应:**
```json
[
  {
    "key": "string",
    "scope": "string",
    "scope_id": "string|null",
    "memory_type": "string",
    "tags": "string",
    "created_at": "timestamp",
    "updated_at": "timestamp"
  }
]
```

对于 project 作用域,`scope_id` 是项目 ID;对于 session/agent 作用域,则是 session/agent ID;global 作用域下为 `null`。

### GET /memory/{key}
按 key 展示一条 memory(当同一个 key 存在于多个作用域时,取第一个匹配项;可通过 `scope`/`scope_id` 收窄范围)。

**参数:**
- `scope`(字符串,可选):要搜索的作用域
- `scope_id`(字符串,可选):要搜索的 project/session/agent

**响应:** 列表条目的结构,再加上 `"content"`(最新的 wiki section)。
若没有精确匹配的 key,返回 `404`。

### DELETE /memory/{key}
按 key 删除一条 memory。

**参数:**
- `scope`(字符串,可选):memory 的作用域(默认:`project`)
- `scope_id`(字符串):对 `project`、`session` 和 `agent` 作用域是必填的(缺失则返回 `400`)

**响应:**
```json
{
  "success": true
}
```

若该 key 在指定作用域下不存在,返回 `404`。

### DELETE /memory
清空某个作用域下的所有 memories。尽力而为:即使单个条目删除失败也会继续,并报告共删除了多少条。

**参数:**
- `scope`(字符串,必填):要清空的作用域
- `scope_id`(字符串):对 `project`、`session` 和 `agent` 作用域是必填的(缺失则返回 `400`)

**响应:**
```json
{
  "success": true,
  "deleted_count": 3
}
```

---

## 错误响应

所有端点都返回标准的 HTTP 状态码:

- `200 OK`:成功
- `201 Created`:资源已创建
- `400 Bad Request`:参数无效
- `404 Not Found`:资源未找到
- `500 Internal Server Error`:服务器错误

错误响应格式:
```json
{
  "detail": "Error message"
}
```

---
