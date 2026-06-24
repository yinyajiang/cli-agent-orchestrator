# 外部工具集成

CAO skill 遵循通用的 [SKILL.md](https://github.com/anthropics/skills) 格式。任何读取这种格式的 LLM harness 都可以直接使用 CAO skill —— 无需转换。

任何能加载 SKILL.md 文件的工具都可以使用这些 skill。下面以 [OpenClaw](https://github.com/openclaw/openclaw) 和 [Hermes Agent](https://github.com/NousResearch/hermes-agent) 为示例讲解;同样的方法适用于任何兼容的 harness。

## 这能带来什么

把 `cao-session-management` skill 加入某个外部工具后,该工具中的 agent 就能通过 shell 命令编排 CAO session —— 启动 supervisor agent、派发任务、收集结果,而无需离开自己的对话循环。

该 agent 可以:

- **启动一个 CAO session**,指定特定的 agent profile 和初始任务
- **同步派发工作** —— 阻塞直到 CAO agent 完成,并内联返回结果
- **异步派发工作** —— 发出任务后继续,稍后再回来查看状态
- **监控 session** —— 列出活跃 session、查看 worker 状态、获取输出
- **关闭 session** —— 完成后清理

这让任何兼容 SKILL.md 的工具都能成为 CAO 多 agent 系统的编排客户端。

## 前置条件

- 已安装并初始化 CAO(`cao init`)
- `cao-server` 正在运行(`cao-server`)
- 目标工具已安装,且有可写的 skill 目录
- 共享文件系统(symlink 要求两者在同一台机器上)

## 设置

### 选项 A:Symlink(推荐)

```bash
# Replace TARGET_SKILLS with your tool's skill directory
TARGET_SKILLS=~/.openclaw/workspace/skills          # OpenClaw example
# TARGET_SKILLS=~/.hermes/skills/cli-agent-orchestrator   # Hermes Agent example
mkdir -p "$TARGET_SKILLS"

# Symlink the session management skill
ln -sf ~/.aws/cli-agent-orchestrator/skills/cao-session-management \
       "$TARGET_SKILLS/cao-session-management"
```

Symlink 会随 CAO 升级自动保持同步。

### 选项 B:让你的工具指向 CAO 的 skill 目录

某些工具可以从额外的目录加载 skill,而无需复制或 symlink。对 OpenClaw 而言,可以在 `~/.openclaw/openclaw.json` 中把 CAO 的 skill store 添加为额外的 skill 根目录:

```json5
{
  skills: {
    load: {
      extraDirs: ["~/.aws/cli-agent-orchestrator/skills"]
    }
  }
}
```

这让所有 CAO skill 都对 OpenClaw agent 可见,且不涉及任何文件操作。

### 选项 C:让 agent 自己安装

如果外部工具的 agent 拥有文件系统访问权限,可以直接让它安装该 skill:

> Install the skill from ~/.aws/cli-agent-orchestrator/skills/cao-session-management into your skills directory

该 agent 会读取 SKILL.md,把该目录复制到自己的 workspace,并在后续 session 中使其可用。

对 Hermes Agent 而言,该 agent 可以运行 `from pathlib import Path; skill_manage(action='create', name='cao-session-management', category='cli-agent-orchestrator', content=Path('~/.aws/cli-agent-orchestrator/skills/cao-session-management/SKILL.md').expanduser().read_text())`,把该 skill 注册到 `~/.hermes/skills/cli-agent-orchestrator/cao-session-management/`。注意,选项 C 会创建一份副本,在 CAO 升级后会变得过期 —— 当有共享文件系统时,请优先使用选项 A(symlink)。

## 作用范围

这给外部 agent 提供的是**知识**,告诉它如何通过 `cao session` shell 命令驱动 CAO。它并不会把 CAO 作为实时 MCP server 加入 —— agent 调用的是 shell 命令,而不是 MCP 工具。如果需要直接的 MCP 访问,请改为把 `cao-ops-mcp-server` 加入目标工具的 MCP 配置。

## 相关

- [Skills reference](skills.md) —— 编写、CLI 命令、provider 交付
- [Control Planes](control-planes.md) —— 在 CLI、MCP 和 Web UI 之间做选择
