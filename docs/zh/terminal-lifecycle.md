# Terminal 生命周期

## 概览

每个由 CAO 创建的 terminal(通过 `assign` 或 `handoff`)都会占用一个 tmux 窗口和一条数据库记录。在长时间运行的 session 中,terminal 会不断累积并可能耗尽系统资源。CAO 提供了自动和手动两种清理途径。

## 删除途径

| 删除方式 | 是否保存快照? |
|----------|----------------|
| Handoff 成功完成(自动删除) | 是 |
| `delete_terminal` MCP 工具 | 是 |
| `DELETE /terminals/{id}` API | 是 |
| `cao shutdown --session <name>` | 否 |
| `cao shutdown --all` | 否 |
| 进程崩溃 | 否 |

只有当 terminal 通过 `terminal_service.delete_terminal` 被单独删除时才会保存快照。Session 级别的关闭(`delete_session`)会直接杀掉窗口,不会生成快照。如果你希望保留 scrollback,请在关闭 session 之前逐个删除 terminal。

## 快照文件

删除时会向 `~/.cao/logs/terminal/` 写入两个文件:

- `<terminal_id>.scrollback` —— 整个 pane scrollback 的纯文本捕获
- `<terminal_id>.snapshot.json` —— 用于恢复的元数据

快照 JSON schema:

```json
{
  "terminal_id": "...",
  "session_name": "...",
  "window_name": "...",
  "agent_profile": "...",
  "provider": "...",
  "working_directory": "...",
  "allowed_tools": null
}
```

所有三类文件(`.log`、`.scrollback`、`.snapshot.json`)都会在 `RETENTION_DAYS`(默认:7)之后由清理服务清除。

## 恢复

```bash
cao terminal restore <terminal_id>
```

这会在原 session 中以原始工作目录创建一个**纯 shell 窗口**,并通过 `cat ... ; exec $SHELL -l` 重放已保存的 scrollback。

限制:

- 原 session 必须仍然存在。如果 session 已被关闭,恢复会失败。你仍然可以直接读取 scrollback:
  `cat ~/.cao/logs/terminal/<terminal_id>.scrollback`
- 恢复创建的是 shell 窗口,而不是重新启动的 agent。该窗口会显示旧的输出,但不会连接到任何 provider。

## Assign 与 handoff 的清理

- **Handoff** terminal 在成功后会自动删除。无需任何操作。
- **Assign** terminal 不会自动删除。当你不再需要该 terminal 时调用 `delete_terminal(terminal_id)`,或者等待 10-terminal 提醒。

## Terminal 数量提醒

当某个 session 达到 10 个 terminal 时,`assign` 和 `handoff` 的响应会包含:

> NOTE: This session has N terminals. Consider calling delete_terminal on
> terminals you no longer need.
