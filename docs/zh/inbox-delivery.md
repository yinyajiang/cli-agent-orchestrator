# Inbox 投递

## 概览

当 agent 调用 `send_message(terminal_id, message)` 时,该消息会进入数据库队列,并通过 bracketed paste 投递到目标终端的输入区。投递有两条路径:

1. **立即投递(Immediate)**:API 端点在持久化消息之后立即尝试投递
2. **看门狗(Watchdog)**:一个 `PollingObserver`(5 秒间隔)监控终端日志文件的变化,并在检测到空闲模式时尝试投递

两条路径最终都会汇聚到 `check_and_send_pending_messages()`,由它根据终端状态决定是否放行投递。

## 标准投递

默认情况下,只有当终端状态为 **IDLE** 或 **COMPLETED** 时才会投递消息。这能确保 provider 的 TUI 已准备好接收输入,消息不会被丢失,也不会破坏终端状态。

## Eager 投递(预先投递)

某些 provider(例如 Claude Code)的 TUI 即使在处理过程中也会缓存粘贴的输入。对于这类 provider,等待 IDLE 会在 agent 轮次之间引入不必要的延迟。

Eager 投递允许在 **PROCESSING** 和 **WAITING_USER_ANSWER** 状态下投递消息,从而消除轮次之间的间隔。

### 启用

在启动 CAO 服务器之前设置环境变量:

```bash
export CAO_EAGER_INBOX_DELIVERY=true
cao-server
```

禁用时(默认),投递行为保持不变 —— 消息会等待 IDLE 或 COMPLETED。

### 双标志门控

Eager 投递需要同时满足两个条件:

1. **环境变量**(`CAO_EAGER_INBOX_DELIVERY=true`):运维人员的全局总开关
2. **Provider 能力**(`accepts_input_while_processing = True`):按 provider 单独开启

这能防止意外地把输入投递给那些在处理过程中会被未请求输入破坏的 TUI。

### 看门狗路径有何不同

不启用 eager 投递时,看门狗在尝试投递前会先做一个快速的 `_has_idle_pattern()` 检查。对于支持 eager 的 provider,这一检查会被跳过(在 PROCESSING 期间没有空闲模式),看门狗会直接进入 `check_and_send_pending_messages()`,由那里的完整状态门控来裁决。

### Provider 能力:`accepts_input_while_processing`

这是 `BaseProvider` 上的一个属性(默认 `False`),用于表明某个 provider 的 TUI 是否能在处理过程中安全地缓存粘贴的输入。在支持该行为的 provider 中覆盖为 `True` 即可。

目前已启用:
- **Claude Code**(`ClaudeCodeProvider`):Ink TUI 在任何时候都会缓存输入

其他可能支持的 provider(欢迎贡献):
- **Codex**:基于 TUI,可能缓存输入
- **OpenCode**:基于 TUI,可能缓存输入

要为新的 provider 启用,请覆盖该属性:

```python
@property
def accepts_input_while_processing(self) -> bool:
    """This provider buffers pasted input during processing."""
    return self._initialized
```

`_initialized` 这个门控很重要 —— 它能防止在启动期间投递(此时 `get_status()` 返回 PROCESSING,但 REPL 实际上还没就绪)。

### 风险

| 风险 | 可能性 | 缓解措施 |
|------|-----------|------------|
| 在 PROCESSING 期间投递的消息丢失(agent 在一轮中间出错) | 低 | 消息状态为 DELIVERED;v1 可接受 |
| 看门狗在长轮次期间每 5 秒触发一次 | 中(有上限) | 每个间隔一次 DB 查询 + 一次 tmux 调用;不会放大 |
| 该特性在非 eager provider 上引发回归 | 无 | Provider 标志默认为 False;仅影响 opt-in 的 provider |

## 对账扫描(Reconciliation Sweep)

当接收终端在消息入队时*已经空闲*,立即路径和看门狗路径都可能错过该消息:

- 那一次立即尝试可能观察到一个暂时过期的状态而跳过投递,并且
- 看门狗只在日志文件变化时触发,而一个已经空闲、不再产生任何输出的 agent 永远不会产生这种变化。

当两者都错过时,该消息原本会永远停留在 `PENDING`(issue #131)。

一个与 provider 无关的后台扫描填补了这一缺口。每隔 `INBOX_RECONCILE_INTERVAL`(默认 30 秒),它会为任何停留在 `PENDING` 超过 `INBOX_RECONCILE_GRACE_SECONDS`(默认 30 秒)的消息重新尝试投递,并将其路由回与其他路径相同的 `check_and_send_pending_messages()` 门控。其工作量随*积压的*接收方数量伸缩,而非随 agent 总数:当没有卡住的消息时,扫描只运行一次廉价查询就返回。

### 宽限窗口

扫描会刻意忽略早于宽限窗口的消息。在该窗口内,投递由立即路径和看门狗路径负责;扫描只接管那些它们明显已经有机会处理却错过的消息。这能避免扫描与快速路径在刚入队的消息上竞争,并最大程度地减少与它们重叠。

### 与 OpenCode 轮询器的关系

扫描并不取代 OpenCode 轮询器。它们扮演不同角色:OpenCode 轮询器是针对某个 provider(其日志在 TUI 稳定后停止变化)的快速(5 秒)主唤醒源,而扫描是慢速、与 provider 无关的安全网。两者都复用 `check_and_send_pending_messages()`,因此都共享它已知的重复唤醒竞争;宽限窗口在实践中避免了扫描与快速路径重叠。GH #115 正在跟踪将所有这些唤醒源统一为单一协调投递引擎的工作,届时投递将变成原子的。
