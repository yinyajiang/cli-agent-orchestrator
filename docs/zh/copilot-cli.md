# GitHub Copilot CLI Provider

## 概述

Copilot provider 使 CLI Agent Orchestrator(CAO)能够在由 tmux 管理的会话中运行 **GitHub Copilot CLI**。

该 provider 面向当前的 Copilot CLI 界面(最新版本),不包含旧版兼容性回退。

## 快速开始

### 前置条件

1. **拥有 GitHub Copilot 访问权限**,并成功执行 `copilot login`
2. 已安装 **Copilot CLI**(可使用 `copilot` 命令)
3. 已安装 **tmux**

```bash
# Install Copilot CLI
npm install -g @github/copilot

# Authenticate
copilot login

# Verify
copilot --version
copilot --help
```

### 在 CAO 中使用 Copilot Provider

```bash
# Start CAO server
cao-server

# Install CAO agent profile into Copilot's agents directory
cao install examples/assign/data_analyst.md --provider copilot_cli

# Launch Copilot-backed terminal
cao launch --agents data_analyst --provider copilot_cli
```

通过 HTTP API:

```bash
curl -X POST "http://localhost:9889/sessions?provider=copilot_cli&agent_profile=developer"
```

## 特性

### 状态检测

该 provider 会检测以下状态:

- **IDLE**:Copilot 提示符可见,没有待处理的响应
- **PROCESSING**:尚无空闲提示符 / 仍在运行中
- **WAITING_USER_ANSWER**:可见信任/确认提示符
- **COMPLETED**:响应已存在并已返回提示符
- **ERROR**:检测到明确的错误输出

信任处理在 `initialize()` 中完成。`get_status()` 是只读的。

### 消息提取

`GET /terminals/{terminal_id}/output?mode=last` 通过以下方式提取最终的 assistant 消息:

1. 找到最后一条用户提示行之后的输出
2. 去除尾部的提示符/页脚行
3. 回退到 assistant 前缀提取

### Agent Profile 集成

Copilot provider 现在与其他 provider 遵循相同的拆分方式:

- `cao install --provider copilot_cli` 会将 `<name>.agent.md` 写入 `~/.copilot/agents`
- provider 启动时直接传入 `--agent <name>`
- provider 不会生成运行时 agent markdown 文件

这样可以让 provider 逻辑保持轻量,并将 profile 的物化工作移至安装阶段。

### MCP 集成

CAO 在运行时通过以下方式注入 `cao-mcp-server`:

- `--additional-mcp-config <json>`

实现方式:

- 添加带 `CAO_TERMINAL_ID` 的 `cao-mcp-server`
- 将合并后的 MCP 负载以内联 JSON 形式传入

## 配置

### 必需的 Copilot CLI 参数

Provider 要求你的 Copilot CLI 支持以下参数:

- `--agent`
- `--additional-mcp-config`
- `--allow-all`
- `--autopilot`

当 `copilot --help` 中缺少 `--additional-mcp-config` 时,CAO 会跳过 MCP 配置注入。

### 命令形态

```bash
copilot --allow-all [--agent <name>] --config-dir ~/.copilot \
  --add-dir <cwd> --additional-mcp-config '{"mcpServers":{...}}' --autopilot
```

### 环境变量

Copilot provider 目前没有 provider 专属的环境变量开关。

## 实现说明

- Provider 文件:`src/cli_agent_orchestrator/providers/copilot_cli.py`
- 退出命令:`/exit`
- 粘贴行为:单次回车(`paste_enter_count = 1`)

## 端到端测试

```bash
# Unit tests
uv run pytest test/providers/test_copilot_cli_unit.py -v
uv run pytest test/providers/test_provider_manager_unit.py -v

# Copilot E2E
uv run pytest -m e2e test/e2e/ -k copilot -v -o "addopts="
```

维护者要求的场景:

```bash
uv run pytest -m e2e test/e2e/test_assign.py::TestCopilotCliAssign::test_assign_data_analyst -v -o "addopts="
uv run pytest -m e2e test/e2e/test_assign.py::TestCopilotCliAssign::test_assign_report_generator -v -o "addopts="
uv run pytest -m e2e test/e2e/test_supervisor_orchestration.py::TestCopilotCliSupervisorOrchestration::test_supervisor_handoff -v -o "addopts="
uv run pytest -m e2e test/e2e/test_supervisor_orchestration.py::TestCopilotCliSupervisorOrchestration::test_supervisor_assign_and_handoff -v -o "addopts="
uv run pytest -m e2e test/e2e/test_supervisor_orchestration.py::TestCopilotCliSupervisorOrchestration::test_supervisor_assign_three_analysts -v -o "addopts="
```

## 故障排查

1. **Copilot 无法启动**
   - 重新执行 `copilot login`
   - 验证 `copilot --version`
   - 在 `copilot --help` 中确认必需的参数是否存在

2. **Agent profile 未生效**
   - 安装 profile:`cao install <profile>.md --provider copilot_cli`
   - 启动时使用 `cao launch --agents <agent-name> --provider copilot_cli`

3. **缺少 MCP 工具**
   - 确保当前环境中可解析 `cao-mcp-server`

4. **卡在 WAITING_USER_ANSWER**
   - 检查活动的 tmux 面板中是否存在信任/确认提示,并手动应答一次
