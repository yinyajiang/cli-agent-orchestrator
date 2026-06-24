# 在 GitHub Codespaces 中工作

本项目可以端到端地在 GitHub Codespace 中运行。服务器、Web UI 以及开发工作流都已预先配置好 —— 你只需启动服务器并转发端口即可。

## 前置条件

一个启用了 Codespaces 的 GitHub 账户。默认的 Codespace 机型(2 vCPU / 8 GB RAM)已足以用于开发和测试。

仓库目前还没有自带自定义的 `.devcontainer/devcontainer.json`,因此 Codespaces 会使用默认的 `universal` 镜像。首次构建会安装:

- Python 3.x 和 `uv`(通过默认镜像提供)
- tmux 以及若干 CLI 工具

无需额外的配置步骤。

## 启动服务器

在 codespace 的终端中、仓库根目录下执行:

```bash
pkill -9 -f "cao-server" || true

cd /workspaces/cli-agent-orchestrator
CAO_API_HOST=0.0.0.0 \
CAO_API_PORT=9889 \
CAO_ALLOWED_HOSTS="*" \
CAO_WS_ALLOWED_CLIENTS="*" \
  uv run cao-server --host 0.0.0.0 --port 9889
```

各变量的作用:

| 变量                      | 设置原因                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `CAO_API_HOST=0.0.0.0`    | 绑定到所有网络接口,以便 GitHub 端口转发代理能够访问到服务器。`127.0.0.1` 无法通过转发 URL 访问。 |
| `CAO_API_PORT=9889`       | 转发 URL 所映射到的端口。                                                                                    |
| `CAO_ALLOWED_HOSTS="*"`   | 让 FastAPI 的 `TrustedHostMiddleware` 接受转发过来的 `*.app.github.dev` 主机名。                                   |
| `CAO_WS_ALLOWED_CLIENTS="*"` | 接受来自转发来源的 WebSocket 连接。                                                       |

你应该会看到:

```
INFO:     Uvicorn running on http://0.0.0.0:9889 (Press CTRL+C to quit)
```

## 转发端口

1. 在 codespace 中打开 **Ports** 标签页。
2. 如果端口 `9889` 未列出,请添加它(本地端口 `9889`)。
3. 如果你想在未登录 GitHub 的浏览器中打开 UI,请右键点击该行并把可见性设为 **Public**。**Private** 仅在已通过该 codespace 身份验证的 GitHub.com 标签页中可用。
4. 点击转发地址 —— 该 URL 形如 `https://<codespace-name>-9889.app.github.dev/`。

请打开不带任何路径的根 URL。`cao-server` 在 `/` 提供 Web UI,访问任何未知路径(包括 codespace chrome 末尾的 `<environment_details>`)都会返回 **HTTP 404**,因为 SPA 仅为客户端导航注册了 catch-all 路由。

## 验证

在 codespace 终端中执行:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9889/health   # 200
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9889/         # 200
```

如果在 codespace 内 `/health` 返回 200,但转发 URL 返回 404,则问题出在端口转发上,而不是服务器。请重新检查 **Ports** 标签页。

## 故障排查

| 症状                                                                                   | 原因 / 解决办法                                                                                                                                |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 转发 URL 立即返回 404                                                    | 端口 `9889` 未转发、codespace 已挂起,或在隐身标签页中可见性为 **Private**。打开 **Ports** 标签页,唤醒 / 重新添加该端口。 |
| `curl http://127.0.0.1:9889/` 能访问,但转发 URL 返回 404                            | codespace 已自动挂起。在 GitHub.com 标签页中打开该 codespace 唤醒它,然后重试。                                               |
| `curl http://127.0.0.1:9889/health` 连接被拒绝                         | `cao-server` 进程未运行。使用 [启动服务器](#start-the-server) 中的命令重新启动它。                            |
| `curl http://127.0.0.1:9889/some/path` 返回 404,而 `/` 正常                              | 符合预期 —— 仅注册了 `/`、`/health`、`/docs` 和 OpenAPI 路由。其他路径由 Web UI 在客户端处理。               |
| WebSocket 连接失败,返回 400/403                                                  | `CAO_WS_ALLOWED_CLIENTS` 限制过严。本地开发时可设为 `"*"`。                                                                |
| 浏览器在转发 URL 上显示 "No webpage was found"                                | 要么 codespace 已停止,要么端口未转发。见上文。                                                                   |

## 停止服务器

在运行 `cao-server` 的终端中按 `Ctrl+C`。codespace 会在默认的空闲超时(30 分钟)后自动挂起;一旦 codespace 被挂起,转发 URL 就会开始返回 404。

---

注意:翻译中锚点 `#start-the-server` 保持英文原文不变。
