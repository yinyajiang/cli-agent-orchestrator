# 工作目录支持

CAO 支持为 agent 的 handoff/委派操作指定工作目录。

## 配置

在 MCP 工具中启用工作目录参数:

```bash
export CAO_ENABLE_WORKING_DIRECTORY=true
```

## 行为

- **禁用时(默认)**:工作目录参数对工具不可见,agent 在 supervisor 的当前目录中启动
- **启用时**:工具暴露 `working_directory` 参数,允许显式指定目录
- **默认目录**:supervisor agent 的当前工作目录(`cwd`)

## 使用示例

启用 `CAO_ENABLE_WORKING_DIRECTORY=true` 后:

```python
# Handoff to agent in specific package directory
result = await handoff(
    agent_profile="developer",
    message="Fix the bug in UserService.java",
    working_directory="/workspace/src/MyPackage"
)

# Assign task with specific working directory
result = await assign(
    agent_profile="reviewer",
    message="Review the changes in the authentication module",
    working_directory="/workspace/src/AuthModule"
)
```

## 路径校验与安全

所有工作目录路径在使用前都会被规范化并校验。路径通过 `os.path.realpath` 解析,以归一化 symlink 和 `..` 序列。

### 允许的目录

- 用户的主目录及其任意子目录(`~/projects/foo`)
- 外部卷和挂载点(例如 `/Volumes/workplace/project`)
- 自定义路径,如 `/opt/projects`、NFS 挂载、企业开发桌面
- 任何**不是**被阻止的系统路径的真实目录

### 被阻止(不安全)的目录

以下系统目录会被显式阻止:

`/`、`/bin`、`/sbin`、`/usr/bin`、`/usr/sbin`、`/etc`、`/var`、`/tmp`、`/dev`、`/proc`、`/sys`、`/root`、`/boot`、`/lib`、`/lib64`

在 macOS 上,`/private/etc`、`/private/var` 和 `/private/tmp` 也会被阻止(因为 `/etc` -> `/private/etc`,等等)。

### Symlink 处理

Symlink 会在校验时被解析。指向被阻止系统路径的 symlink(例如 `~/escape` -> `/etc`)在解析之后会被拒绝。

## 为什么默认禁用?

当 `working_directory` 参数对 agent 可见时,它们可能会臆造或错误推断目录路径,而不使用默认值(当前工作目录)。默认禁用可以避免不需要显式目录控制的用户遇到这种行为。如果你的工作流需要把任务委派到特定目录,请启用此功能,并在 agent 指令中提供显式路径。
