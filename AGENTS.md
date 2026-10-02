# AGENTS.md

## Python 环境

- 本项目所有 Python 操作必须使用 `.venv` 虚拟环境。
- 运行 Python 脚本：`.venv/bin/python <脚本>`
- 安装依赖：`.venv/bin/pip install <包名>`
- 不要使用系统全局 `python3`/`pip`（系统无 pip，且受 PEP 668 保护）。
- 依赖清单记录到 `requirements.txt`。

## 已安装依赖

- 数值/科学计算：`numpy` `scipy`
- 数据处理：`pandas`
- 绘图：`seaborn` `plotly`
- 完整清单见 `requirements.txt`。

## Git 项目管理

- 本项目使用 Git 管理所有改动，仓库根目录为本项目根目录。
- **每次完成一个可验证的改动都必须提交 Git**，不允许长期积累未提交修改。
- 提交前必须运行受影响范围的测试 / 构建 / 启动检查；无法运行时必须在提交信息或任务说明中说明原因。
- 提交信息使用 `type(scope): subject` 格式，例如：
  - `feat(backend): add health endpoint`
  - `feat(frontend): add second-order lab shell`
  - `docs(progress): update todo after T1`
  - `fix(compute): correct settling-time tolerance`
- 一个提交只做一件事，不要把无关改动混在同一提交中。
- 禁止提交：`.env`、真实 API Key、`data/*.db`、`.venv/`、`node_modules/`、构建产物、`.npm-cache/`。
- 每完成一个任务，必须同步更新 `todo.html`，并把 `todo.html` 的更新一起提交。
- 智能体完成任务汇报时必须包含：改动文件、验证命令与结果、Git commit hash。
