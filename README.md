# StudyPlusPlus

一个面向数学和物理基础薄弱学习者的控制理论可视化学习网站。

项目以《控制之美》的目录为课程大纲，用交互式可视化、Python 后端计算和全局 AI 助教帮助理解控制理论。

> 仓库地址：https://github.com/MXuanZero/StudyPlusPlus

## 当前已实现

- 第 1–6 章课程目录，其中第 3、4、5、6 章已接入教学内容
- 二阶系统交互式实验室：阶跃 / 冲激 / 初始状态、极点图、相轨迹、性能指标、参数对比、CSV 导出
- AI 助教：全局对话、流式输出、Markdown + KaTeX、引用课程正文提问、正文划线回跳、会话自动命名
- 设置页：可切换 DeepSeek / OpenAI 兼容接口 / Ollama / 自定义，支持测试连接与系统提示词编辑
- 学习进度、笔记、聊天历史持久化到本地 SQLite
- 白色简洁桌面端界面

## 快速启动

环境要求：

- Python 3.11+（推荐 3.14）
- Node.js 18+（推荐 20/22/24）

```bash
git clone https://github.com/MXuanZero/StudyPlusPlus.git
cd StudyPlusPlus
chmod +x start.sh
./start.sh
```

启动后访问：

```text
http://127.0.0.1:8000
```

开发模式：

```bash
./start.sh --dev
```

指定端口：

```bash
./start.sh --port 9000
```

## 大模型配置

不配置 API Key 时，AI 助教自动使用 Mock 模式，学习功能不受影响。

配置方式：

1. 启动网站后打开首页 →「模型设置」
2. 选择供应商并填写 Base URL、模型名、API Key
3. 保存后点击「测试连接」

也支持环境变量：

```bash
export LLM_API_KEY="你的 API Key"
./start.sh
```

优先级：数据库设置 > 环境变量 > Mock 模式。

## 文档

| 文档 | 内容 |
| --- | --- |
| `docs/00_README.md` | 文档索引与关键决策 |
| `docs/01_产品需求文档.md` | 产品目标与范围 |
| `docs/02_技术方案与架构.md` | 技术栈、API、数据模型 |
| `docs/03_二阶系统分析模块详细设计.md` | 核心计算与交互规格 |
| `docs/04_开发任务拆分与验收.md` | 任务拆分与验收标准 |
| `docs/05_MVP验收报告.md` | MVP 独立验收结果 |
| `docs/06_新机器初始化与启动.md` | 新机器从零安装与启动指南 |
| `todo.html` | 开发进度看板 |

## 常用命令

```bash
# 后端测试
.venv/bin/pytest -q

# 前端构建
cd frontend
npm run build
cd ..

# 手动启动生产模式
cd backend
../.venv/bin/uvicorn app.main:app --port 8000
```
