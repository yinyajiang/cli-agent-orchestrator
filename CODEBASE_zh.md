# CLI Agent Orchestrator 代码库

## 架构概览

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Entry Points                                │
├─────────────────────────────┬───────────────────────────────────────┤
│       CLI Commands          │         MCP Server                    │
│       (cao launch)          │    (handoff, send_message)            │
└──────────────┬──────────────┴──────────────┬────────────────────────┘
               │                             │
               └─────────────┬───────────────┘
                             │
                      ┌──────▼──────┐
                      │  FastAPI    │
                      │  HTTP API   │
                      │  (:9889)    │
                      └──────┬──────┘
                             │
                      ┌──────▼──────┐
                      │  Services   │
                      │  Layer      │
                      ├─────────────┤
                      │ • session   │
                      │ • terminal  │
                      │ • inbox     │
                      │ • flow      │
                      └──────┬──────┘
                             │
                ┌────────────┴────────────┐
                │                         │
           ┌────▼────┐               ┌────▼─────┐
           │ Clients │               │Providers │
           ├─────────┤               ├──────────┤
           │ • tmux  │               │ • kiro   │
           │ • db    │               │   _cli   │
           └────┬────┘               │ • q_cli  │
                │                    │ • claude │
         ┌──────┴──────┐             │   _code  │
         │             │             │ • codex  │
    ┌────▼────┐  ┌─────▼─────┐      │          │
    │  Tmux   │  │  SQLite   │      │          │
    │ Sessions│  │  Database │      │          │
    └─────────┘  └───────────┘      └────┬─────┘
                                         │
                                   ┌─────▼──────┐
                                   │ CLI Tools  │
                                   │• Kiro CLI  │
                                   │• Claude    │
                                   │  Code      │
                                   │  (default) │
                                   │• Codex CLI │
                                   └────────────┘
```

> 说明：以上架构图为对齐敏感的 ASCII 示意图，其中的 CLI 命令、服务名、provider 名等均按原文保留。各层级含义：Entry Points（入口点）→ FastAPI HTTP API → Services Layer（服务层：session / terminal / inbox / flow）→ Clients（客户端：tmux、db）与 Providers（provider：kiro_cli、q_cli、claude_code、codex）→ CLI Tools（Kiro CLI 默认、Claude Code、Codex CLI）。

## 目录结构

```
src/cli_agent_orchestrator/
├── cli/commands/          # 入口点：CLI 命令
│   ├── launch.py          # 创建带有 agent profile 的终端（工作区信任确认、--yolo 标志）
│   ├── info.py            # 显示会话信息（cao info）
│   ├── mcp_server.py      # 启动 MCP 服务器（cao mcp-server）
│   └── init.py            # 初始化数据库
├── mcp_server/            # 入口点：MCP 服务器
│   ├── server.py          # handoff 与 send_message 工具
│   └── models.py          # HandoffResult 模型
├── api/                   # 入口点：HTTP API
│   └── main.py            # FastAPI 端点（端口 9889）
├── services/              # 服务层：业务逻辑
│   ├── event_bus.py       # 基于通配符主题匹配的发布/订阅事件路由
│   ├── fifo_reader.py     # 发布者：terminal.{id}.output（FIFO → 事件总线）
│   ├── status_monitor.py  # 消费者：terminal.{id}.output → 发布者：terminal.{id}.status
│   ├── log_writer.py      # 消费者：terminal.{id}.output（写入调试日志）
│   ├── inbox_service.py   # 消费者：terminal.{id}.status（投递排队中的消息）
│   ├── session_service.py # 列出、获取、删除会话
│   ├── terminal_service.py# 创建、获取、发送输入、获取输出、删除终端
│   └── flow_service.py    # 调度的 flow 执行
├── clients/               # 客户端层：外部系统
│   ├── tmux.py            # Tmux 操作（设置 CAO_TERMINAL_ID、send_keys、用于 bracketed paste 的 send_keys_via_paste）
│   └── database.py        # SQLite，包含 terminals 与 inbox_messages 表
├── providers/             # Provider 层：CLI 工具集成
│   ├── base.py            # 抽象 provider 接口（mark_input_received 钩子）
│   ├── manager.py         # 将 terminal_id 映射到 provider
│   ├── kiro_cli.py        # Kiro CLI provider（kiro_cli）
│   ├── q_cli.py           # Amazon Q CLI provider（q_cli）
│   ├── claude_code.py     # Claude Code provider（claude_code，❯ 提示符，trust prompt 处理）- 默认
│   └── codex.py           # Codex/ChatGPT CLI provider（codex，developer_instructions，› 提示符 + • 列表项检测，trust prompt 处理）
├── models/                # 数据模型
│   ├── terminal.py        # Terminal、TerminalStatus
│   ├── session.py         # Session 模型
│   ├── inbox.py           # InboxMessage、MessageStatus
│   ├── flow.py            # Flow 模型
│   └── agent_profile.py   # AgentProfile 模型
├── utils/                 # 工具
│   ├── terminal.py        # 生成 ID、等待 shell/status
│   ├── logging.py         # 基于文件的日志
│   ├── agent_profiles.py  # 加载 agent profile
│   └── template.py        # 模板渲染
├── agent_store/           # Agent profile 定义（.md 文件）
│   ├── developer.md
│   ├── reviewer.md
│   └── code_supervisor.md
└── constants.py           # 应用常量
```

## 数据流示例

### 终端创建流程
```
cao launch --agents code_sup
  ↓
terminal_service.create_terminal()
  ↓
tmux_client.create_session(terminal_id)  # 设置 CAO_TERMINAL_ID
  ↓
database.create_terminal()
  ↓
provider_manager.create_provider()
  ↓
provider.initialize()  # 等待 shell 就绪（所有 provider）、发送命令、等待 IDLE
  ↓
fifo_manager.create_reader(terminal_id)  # 启动 FIFO reader 线程
  ↓
返回 Terminal 模型
```

### Inbox 消息流程
```
MCP: send_message(receiver_id, message)
  ↓
API: POST /terminals/{receiver_id}/inbox/messages
  ↓
database.create_inbox_message()  # 状态：PENDING
  ↓
inbox_service.deliver_pending(receiver_id)  # POST 时立即尝试
  ↓
若接收方为 IDLE/COMPLETED → 立即发送（先标记为 DELIVERED，#164）
若接收方忙碌 → 消息保持 PENDING
  ↓
FIFO 输出 → StatusMonitor 在状态变化时发布 terminal.{id}.status
  ↓
InboxService（消费 terminal.*.status）在 IDLE/COMPLETED 时调用 deliver_pending()
  ↓
更新消息状态：DELIVERED
```

### Handoff 流程
```
MCP: handoff(agent_profile, message)
  ↓
API: POST /sessions/{session}/terminals
  ↓
等待终端 IDLE
  ↓
API: POST /terminals/{id}/input
  ↓
轮询直到 status = COMPLETED
  ↓
API: GET /terminals/{id}/output?mode=last
  ↓
API: POST /terminals/{id}/exit
  ↓
将输出返回给调用方
```
