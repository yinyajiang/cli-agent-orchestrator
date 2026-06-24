# Flows —— 定时 Agent 会话

Flows 允许你使用 cron 表达式调度 agent 会话自动运行。

## 前置条件

安装你想使用的 agent profile:

```bash
cao install developer
```

## 快速开始

这个示例 flow 会在每天早上 7:30 问一个简单的世界冷知识问题。

```bash
# 1. 启动 cao 服务端
cao-server

# 2. 在另一个终端里,添加一个 flow
cao flow add examples/flow/morning-trivia.md

# 3. 列出 flow 查看调度和状态
cao flow list

# 4. 手动运行一个 flow(可选 —— 用于测试)
cao flow run morning-trivia

# 5. 查看 flow 执行情况(运行之后)
tmux list-sessions
tmux attach -t <session-name>

# 6. 完成后清理会话
cao shutdown --session <session-name>
```

> **重要:**`cao-server` 必须正在运行,flow 才能按调度执行。

## 示例 1:简单定时任务

一个以固定间隔运行、使用静态 prompt 的 flow(无需脚本)。

**文件:`daily-standup.md`**

```yaml
---
name: daily-standup
schedule: "0 9 * * 1-5"  # 9am weekdays
agent_profile: developer
provider: kiro_cli  # Optional, defaults to kiro_cli
---

Review yesterday's commits and create a standup summary.
```

## 示例 2:带健康检查的条件执行

一个监控服务、仅在出现问题时才执行的 flow。

**文件:`monitor-service.md`**

```yaml
---
name: monitor-service
schedule: "*/5 * * * *"  # Every 5 minutes
agent_profile: developer
script: ./health-check.sh
---

The service at [[url]] is down (status: [[status_code]]).
Please investigate and triage the issue:
1. Check recent deployments
2. Review error logs
3. Identify root cause
4. Suggest remediation steps
```

**脚本:`health-check.sh`**

```bash
#!/bin/bash
URL="https://api.example.com/health"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$URL")

if [ "$STATUS" != "200" ]; then
  # Service is down - execute flow
  echo "{\"execute\": true, \"output\": {\"url\": \"$URL\", \"status_code\": \"$STATUS\"}}"
else
  # Service is healthy - skip execution
  echo "{\"execute\": false, \"output\": {}}"
fi
```

## Flow 命令

```bash
# 添加一个 flow
cao flow add daily-standup.md

# 列出所有 flow(显示调度、下次运行时间、启用状态)
cao flow list

# 启用/禁用一个 flow
cao flow enable daily-standup
cao flow disable daily-standup

# 手动运行一个 flow(忽略调度)
cao flow run daily-standup

# 移除一个 flow
cao flow remove daily-standup
```
