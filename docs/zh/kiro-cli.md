# Kiro CLI Provider

## 概述

Kiro CLI provider 让 CLI Agent Orchestrator(CAO)能够与 **Kiro CLI** 协同工作——这是一款基于 agent 对话、支持自定义 profile 的 AI 编码助手。

## 快速开始

### 前置条件

1. **AWS 凭证**:Kiro CLI 通过 AWS 进行认证
2. **Kiro CLI**:安装该 CLI 工具
3. **tmux**:终端管理所需

```bash
# 安装 Kiro CLI
npm install -g @anthropic-ai/kiro-cli

# 验证认证
kiro-cli --version
```

### 在 CAO 中使用 Kiro CLI Provider

```bash
# 启动 CAO 服务
cao-server

# 启动一个基于 Kiro CLI 的会话(必须提供 agent profile)
cao launch --agents developer --provider kiro_cli
```

通过 HTTP API:

```bash
curl -X POST "http://localhost:9889/sessions?provider=kiro_cli&agent_profile=developer"
```

**注意**:Kiro CLI 必须提供 agent profile——没有 profile 无法启动。

## 功能特性

### 状态检测

Kiro CLI provider 通过分析去除 ANSI 码后的输出来检测终端状态:

- **IDLE**:agent 提示符可见(传统的 `[profile_name] >` 或新 TUI 的 `ask a question, or describe a task`),且没有响应内容
- **PROCESSING**:输出中找不到空闲提示符(agent 正在生成响应)
- **COMPLETED**:出现绿色箭头(`>`)响应标记(传统)或 `▸ Credits:` 标记(TUI),且其后出现空闲提示符
- **WAITING_USER_ANSWER**:出现权限提示(`Allow this action? [y/n/t]:`)
- **ERROR**:出现已知错误标识(例如 "Kiro is having trouble responding right now")

状态检测优先级:无提示符 → PROCESSING → ERROR → WAITING_USER_ANSWER → COMPLETED → IDLE。

该 provider 在所有状态检测和消息提取中都同时支持传统 UI 提示符格式和新的 TUI 格式。

### 动态提示符模式

该 provider 支持两种提示符格式:

**传统 UI**(配合 `--legacy-ui` flag 使用):

```
[developer] >          # 基础提示符
[developer] !>         # 带有待处理改动的提示符
[developer] 50% >      # 带进度指示的提示符
[developer] λ >        # 带 lambda 符号的提示符
[developer] 50% λ >    # 进度与 lambda 组合
```

模式:`\[{agent_profile}\]\s*(?:\d+%\s*)?(?:λ\s*)?!?>\s*`

**新 TUI**(最新版 Kiro CLI 默认):

```
code_supervisor · claude-opus-4.6-1m · ◔ 1%
 ask a question, or describe a task ↵
```

新 TUI 的空闲状态由 `ask a question, or describe a task` 模式检测,完成状态则由 `▸ Credits:` 标记后跟空闲提示符来检测。该 provider 默认以 TUI 模式启动,并自动检测当前激活的是哪种格式。

### 消息提取

该 provider 采用双路径提取策略:

**传统模式**(绿色箭头标记):
1. 从输出中去除 ANSI 码
2. 找出所有绿色箭头(`>`)标记(响应起点)
3. 取最后一个
4. 找到其后下一个空闲提示符(响应终点)
5. 提取两者之间的文本并清洗

**TUI 模式**(分隔线 + Credits 标记):
1. 找到最后一行 `▸ Credits:`(响应终点标记)
2. 找到 Credits 之前最后一个分隔线(`────`)(响应起点区域)
3. 提取分隔线与 Credits 之间的文本
4. 跳过第一段(用户消息回显)
5. 清洗剩余文本(ANSI、转义序列、控制字符)

该 provider 会先尝试传统模式提取;如果找不到绿色箭头,则回退到 TUI 提取。这一行为与 `--legacy-ui` 包装脚本向后兼容。

### 权限提示

Kiro CLI 会对敏感操作(文件编辑、命令执行)显示 `Allow this action? [y/n/t]:` 提示。该 provider 将其检测为 `WAITING_USER_ANSWER` 状态。与 Claude Code 不同,Kiro CLI 没有信任文件夹对话框。

## 配置

### Agent Profile(必需)

Kiro CLI 始终需要一个 agent profile。CAO 通过以下方式传入:

```
kiro-cli chat --agent {profile_name}
```

profile 名称决定了用于状态检测的提示符模式。内置 profile 包括 `developer` 和 `reviewer`。

### 启动命令

该 provider 使用 kiro-cli 默认 UI 启动,并自动回退到 `--legacy-ui`:

```
kiro-cli chat --agent developer
```

该 provider 会自动检测终端处于传统模式还是 TUI 模式,并使用对应的检测模式。如果初始化超时,该 provider 会自动退出并使用 `--legacy-ui` 重试。TUI 和传统两种检测模式都得到完整支持。

## 实现说明

- **去除 ANSI**:所有模式匹配都在去除 ANSI 码后的输出上进行,以保证可靠性
- **绿色箭头模式**:`^>\s*` 匹配 agent 响应的起点(在去除 ANSI 之后)
- **通用提示符模式**:`\x1b\[38;5;13m>\s*\x1b\[39m\s*$` 匹配原始输出中的紫色提示符(用于日志监控)
- **错误检测**:检查已知错误字符串,例如 "Kiro is having trouble responding right now"
- **多格式清洗**:提取过程会去除 ANSI 码、转义序列和控制字符
- **退出命令**:通过 `POST /terminals/{terminal_id}/exit` 发送 `/exit`

### 状态取值

- `TerminalStatus.IDLE`:可接受输入
- `TerminalStatus.PROCESSING`:正在处理任务
- `TerminalStatus.WAITING_USER_ANSWER`:等待权限确认
- `TerminalStatus.COMPLETED`:任务完成
- `TerminalStatus.ERROR`:发生错误

## 端到端测试

E2E 测试套件验证了 Kiro CLI 的 handoff、assign 和 send_message 流程。

### 运行 Kiro CLI E2E 测试

```bash
# 启动 CAO 服务
uv run cao-server

# 运行所有 Kiro CLI E2E 测试
uv run pytest -m e2e test/e2e/ -v -k kiro_cli

# 运行特定测试类型
uv run pytest -m e2e test/e2e/test_handoff.py -v -k kiro_cli
uv run pytest -m e2e test/e2e/test_assign.py -v -k kiro_cli
uv run pytest -m e2e test/e2e/test_send_message.py -v -k kiro_cli
uv run pytest -m e2e test/e2e/test_supervisor_orchestration.py -v -k KiroCli -o "addopts="
```

## 故障排查

### 常见问题

1. **"Agent profile required" 错误**:
   - Kiro CLI 没有 agent profile 无法启动
   - 启动时务必指定 `--agents`:`cao launch --agents developer --provider kiro_cli`

2. **权限提示阻塞**:
   - Kiro CLI 会对操作显示 `[y/n/t]` 提示
   - 该 provider 将其检测为 `WAITING_USER_ANSWER`
   - 在多 agent 流程中,需由 supervisor 或用户处理这些提示

3. **认证问题**:
   ```bash
   # 验证 AWS 凭证
   aws sts get-caller-identity
   # 通过环境变量设置凭证
   export AWS_ACCESS_KEY_ID=...
   export AWS_SECRET_ACCESS_KEY=...
   export AWS_DEFAULT_REGION=...
   ```

4. **提示符模式不匹配**:
   - 该 provider 同时支持传统(`[name] >`)和新 TUI(`ask a question, or describe a task`)格式
   - TUI 模式为默认;该 provider 会自动检测当前激活的格式
   - 如果你需要传统模式,可通过包装脚本添加 `--legacy-ui`
   - 检查方式:`kiro-cli chat --agent your_profile`

5. **仅有 JSON 的 Agent Profile(由 AIM 安装)**:
   - 通过 AIM(Agent Install Manager)安装的 agent 可能只有 `.json` profile(例如 `~/.kiro/agents/librarian/agent-spec.json`)
   - CAO 的 `load_agent_profile()` 主要扫描 `.md` 文件
   - 如果找不到该 agent,CAO 会优雅回退——kiro-cli 原生支持解析 `.json` profile
   - 作为变通方法,你可以在 `.json` profile 旁创建一个占位的 `.md` 文件
