# 发布 cli-agent-orchestrator

本项目通过 GitHub Actions 发布到 [PyPI](https://pypi.org/project/cli-agent-orchestrator/)。流水线的设计目标是:每次发布都先进入 **TestPyPI**,做冒烟测试,然后等待维护者批准正式发布。

## 流水线概览

```
release.yml (manual)
  └─► bump version + changelog + tag + GitHub Release
        └─► publish-to-pypi.yml (triggered by Release publish)
              ├─► build            (build wheel + sdist once, bundle Web UI)
              ├─► publish-testpypi (environment: testpypi, OIDC)
              ├─► smoke-test       (install from TestPyPI, verify entry points)
              └─► publish-pypi     (environment: pypi — MAINTAINER APPROVAL GATE)
```

认证使用 [PyPI Trusted Publishing (OIDC)](https://docs.pypi.org/trusted-publishers/) —— GitHub 中不存储任何 API token 密钥。

---

## 一次性设置(维护者,每个项目一次)

### 1. 配置 Trusted Publisher

**PyPI:**
1. 前往 https://pypi.org/manage/account/publishing/
2. "Add a new pending publisher",填写:
   - PyPI project name: `cli-agent-orchestrator`
   - Owner: `awslabs`
   - Repository: `cli-agent-orchestrator`
   - Workflow: `publish-to-pypi.yml`
   - Environment: `pypi`

**TestPyPI:**
1. 前往 https://test.pypi.org/manage/account/publishing/
2. 值相同,但 environment 改为:`testpypi`

### 2. 配置 GitHub Environments

在 GitHub:**Settings → Environments**。

**`testpypi`** —— 无限制。(冒烟测试在此运行;无需批准。)

**`pypi`** —— 这是批准门禁:
- **Required reviewers:** 添加可以批准正式发布的维护者团队 / 用户名。
- **Deployment branches and tags:** 限制为匹配 `v*` 的 tag,这样只有打了 tag 的发布才能晋升到正式环境。

### 3. 验证 Web UI 构建在 CI 中可用

无需配置 —— `build` 任务会在 `web/` 下运行 `npm ci && npm run build`,并在 `uv build` 之前把 `web/dist/` 复制到 `src/cli_agent_orchestrator/web_ui/`。wheel 产物包含这些内容,依据 `pyproject.toml` 中的 `[tool.hatch.build].artifacts` 配置。

---

## 切割发布

1. 通过 Actions → "Run workflow" 触发 **`Release`** workflow:
   - 选择 `patch`、`minor` 或 `major`
   - `release.yml` 会提升 `pyproject.toml` 版本、运行 `git-cliff` 更新 `CHANGELOG.md`、提交、打 `v<version>` tag、推送并创建 GitHub Release。
2. GitHub Release 发布会自动触发 **`Publish to PyPI`**:
   - `build` 运行(wheel + sdist,捆绑 Web UI)。
   - `publish-testpypi` 发布到 TestPyPI。
   - `smoke-test` 从 TestPyPI 安装并运行 `cao --help`、`cao-server --help`、`cao-mcp-server --help`。
   - `publish-pypi` **暂停**,等待维护者在 `pypi` 环境中批准。由 required reviewer 在 Actions 运行页面点击 **Review deployments → Approve** 将其发布到正式环境。

### 仅手动发布到 TestPyPI(不切割正式发布)

有时你只想在不切割正式发布的情况下对构建做一次健康检查:

1. Actions → **Publish to PyPI** → "Run workflow"
2. 选择 `environment: testpypi`
3. 只运行 `build` + `publish-testpypi`。冒烟测试和正式步骤被跳过。

### 手动发布到 PyPI(逃生口)

如果已切割了发布但自动流水线中途失败,你需要重试正式步骤:

1. Actions → **Publish to PyPI** → "Run workflow"
2. 选择 `environment: pypi`
3. `build` 运行,`publish-testpypi` + `smoke-test` 被跳过(它们已运行过),`publish-pypi` 会命中维护者批准门禁。

---

## 故障排查

**首次发布出现 "pending publisher" 错误:**
正常。PyPI 会把 publisher 标记为 pending,直到首次成功运行。此后即变为永久。

**冒烟测试报 "No matching distribution" 失败:**
TestPyPI 索引传播可能需要最多一分钟。workflow 会 sleep 30s;若不够,请增加该时长或重试。

**需要批准但按钮缺失:**
检查 `Settings → Environments → pypi → Required reviewers`。你必须列在其中。

**wheel 与 tag 版本不一致:**
`scripts/bump_version.py` 会更新 `pyproject.toml`,`release.yml` 则基于提升后的版本打 tag。如果出现漂移,请手动修复 `pyproject.toml` 并重新运行 release workflow。
