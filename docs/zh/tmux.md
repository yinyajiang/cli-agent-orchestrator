# 使用 tmux Session

所有 CAO agent session 都运行在 tmux 中。你可以直接 attach 到某个 session,实时观察或与 agent 交互。

## 常用命令

```bash
# List all sessions
tmux list-sessions

# Attach to a session
tmux attach -t <session-name>

# Detach from session (inside tmux)
Ctrl+b, then d

# Switch between windows (inside tmux)
Ctrl+b, then n          # Next window
Ctrl+b, then p          # Previous window
Ctrl+b, then <number>   # Go to window number (0-9)
Ctrl+b, then w          # List all windows (interactive selector)

# Delete a session (cleanly, via CAO)
cao shutdown --session <session-name>
```

## 交互式窗口选择器

**列出所有窗口(Ctrl+b, w):**

![Tmux Window Selector](../assets/tmux_all_windows.png)

## 向 spawned agent 转发环境变量

默认情况下,只有一份很严格的白名单环境变量(`HOME`、`PATH`、`SHELL`,以及 `CAO_*` / `KIRO_*` / `MISE_*` / `AWS_*` 前缀)能到达 tmux 中 spawned 的 agent。这个过滤器能让 `tmux new-session -e` 的 argv 保持在内核限制之下,并防止 CAO 自身运行在某个 provider 内时出现嵌套 session 循环。

要向 **supervisor 以及随后在同一 session 中 spawn 的每个 worker**(通过 `assign` / `handoff` / Web UI)转发额外的变量,请在 `cao launch` 时传入 `--env KEY=VALUE`:

```bash
cao launch --agents code_supervisor \
  --env MNEMOSYNE_DIR=/root/mnemosyne \
  --env ISAAC_CHANNEL=room:engineering
```

该 flag 可重复使用。值通过请求体而非 URL 传递,因此密钥不会出现在 cao-server 的 HTTP 访问日志中。

在 CLI 边界会被拒绝:

- 匹配 `CLAUDE` / `CODEX_` / `__MISE_` 的键(保留给 provider 鉴权 —— 那 6 个 `CLAUDE_CODE_USE_*` / `CLAUDE_CODE_SKIP_*` 鉴权 flag 会被显式加入白名单)。
- 不符合 `[A-Za-z_][A-Za-z0-9_]*` 的键(非 POSIX 名称会破坏 shell)。
- 大于等于 2048 字节的值(per-var 上限,用于让 tmux argv 保持在内核限制之下 —— 见 PR #246)。

被转发的变量保存在 cao-server 的进程内存中,session 删除时即被丢弃;重启 cao-server 会清空它们。

## 注意事项

- CAO session 名会自动加上 `cao-` 前缀。在 `tmux attach`、`cao session send` 或 `cao shutdown` 中引用 session 时,请使用带前缀的名字(例如 `cao-my-task`)。
- 请优先使用 `cao shutdown` 而非 `tmux kill-session`:`cao shutdown` 会在拆除 tmux session 之前让每个 provider 干净退出,从而避免泄漏 CLI 进程。
