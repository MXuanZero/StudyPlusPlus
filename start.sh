#!/usr/bin/env bash
# StudyPlusPlus 一键启动脚本
#
# 用法：
#   ./start.sh                  # 生产模式：按需构建前端，启动 FastAPI 单端口
#   ./start.sh --dev            # 开发模式：启动 FastAPI --reload + Vite dev server
#   ./start.sh --no-build       # 生产模式但不重新构建前端
#   ./start.sh --port 9000      # 指定后端端口（默认 8000）
#   ./start.sh --help
#
# 环境变量：
#   HOST=127.0.0.1              后端监听地址
#   PORT=8000                   后端端口
#   FRONTEND_PORT=5173          开发模式下 Vite 端口

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

MODE="prod"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
BUILD_FRONTEND=1

usage() {
  cat <<'USAGE'
StudyPlusPlus 一键启动脚本

用法：
  ./start.sh                 生产模式：按需构建前端，后端单端口托管
  ./start.sh --dev           开发模式：FastAPI --reload + Vite dev server
  ./start.sh --no-build      生产模式下跳过前端构建
  ./start.sh --port 9000     指定后端端口（默认 8000）
  ./start.sh --host 0.0.0.0  指定监听地址（默认 127.0.0.1）
  ./start.sh --help          显示帮助

环境变量：
  HOST / PORT / FRONTEND_PORT / NPM_CONFIG_CACHE 可覆盖默认值。
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev)
      MODE="dev"
      shift
      ;;
    --no-build)
      BUILD_FRONTEND=0
      shift
      ;;
    --port)
      PORT="${2:?--port 需要一个端口号}"
      shift 2
      ;;
    --host)
      HOST="${2:?--host 需要一个地址}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数：$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Python 环境与后端依赖
# ---------------------------------------------------------------------------
if [[ ! -x ".venv/bin/python" ]]; then
  echo "[1/4] 创建 Python 虚拟环境 .venv ..."
  python3 -m venv .venv
fi

if ! .venv/bin/python - <<'PY' >/dev/null 2>&1
import fastapi, httpx, numpy, scipy, uvicorn, yaml
PY
then
  echo "[1/4] 安装后端依赖（首次运行可能较慢）..."
  .venv/bin/pip install -r requirements.txt
else
  echo "[1/4] 后端依赖已就绪"
fi

# ---------------------------------------------------------------------------
# Node / npm 环境
# ---------------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "错误：未找到 Node.js。开发 / 构建前端需要 Node.js 18+。" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "错误：未找到 npm。" >&2
  exit 1
fi

# 避免 npm 默认缓存在只读 HOME 目录导致 EROFS。
export npm_config_cache="${NPM_CONFIG_CACHE:-$ROOT_DIR/.npm-cache}"
mkdir -p "$npm_config_cache"

if [[ ! -d "frontend/node_modules" ]]; then
  echo "[2/4] 安装前端依赖（首次运行可能较慢）..."
  (cd frontend && npm install --no-audit --no-fund)
else
  echo "[2/4] 前端依赖已就绪"
fi

# ---------------------------------------------------------------------------
# 开发模式
# ---------------------------------------------------------------------------
if [[ "$MODE" == "dev" ]]; then
  echo "[3/4] 开发模式：启动 FastAPI（$HOST:$PORT）和 Vite（$HOST:$FRONTEND_PORT）..."

  cleanup() {
    local exit_code=$?
    trap - EXIT INT TERM
    [[ -n "${BACKEND_PID:-}" ]] && kill "$BACKEND_PID" 2>/dev/null || true
    [[ -n "${FRONTEND_PID:-}" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
    wait 2>/dev/null || true
    exit "$exit_code"
  }
  trap cleanup EXIT INT TERM

  (
    cd backend
    exec env STUDY_DATA_DIR="$ROOT_DIR/data" ../.venv/bin/uvicorn \
      app.main:app --reload --host "$HOST" --port "$PORT"
  ) &
  BACKEND_PID=$!

  (
    cd frontend
    exec npm run dev -- --host "$HOST" --port "$FRONTEND_PORT"
  ) &
  FRONTEND_PID=$!

  sleep 2
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "错误：后端启动失败。" >&2
    exit 1
  fi
  if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    echo "错误：前端启动失败。" >&2
    exit 1
  fi

  echo
  echo "============================================================"
  echo " StudyPlusPlus 开发模式已启动"
  echo " 前端页面：http://$HOST:$FRONTEND_PORT"
  echo " 后端接口：http://$HOST:$PORT/api/v1/health"
  echo " 按 Ctrl+C 停止全部服务"
  echo "============================================================"
  echo
  wait -n "$BACKEND_PID" "$FRONTEND_PID"
  exit 0
fi

# ---------------------------------------------------------------------------
# 生产模式：按需构建前端
# ---------------------------------------------------------------------------
NEED_BUILD=0
DIST_INDEX="frontend/dist/index.html"
if [[ ! -f "$DIST_INDEX" ]]; then
  NEED_BUILD=1
elif find frontend/src frontend/index.html frontend/package.json frontend/package-lock.json \
      frontend/vite.config.ts frontend/tsconfig.json frontend/tsconfig.app.json \
      frontend/tsconfig.node.json \
      -newer "$DIST_INDEX" -print -quit 2>/dev/null | grep -q .; then
  NEED_BUILD=1
fi

if [[ "$BUILD_FRONTEND" == "1" && "$NEED_BUILD" == "1" ]]; then
  echo "[3/4] 检测到前端需要构建，正在执行 npm run build ..."
  (cd frontend && npm run build)
else
  echo "[3/4] 使用已有前端构建（如需强制重建，删除 frontend/dist 后重试）"
fi

if [[ ! -f "$DIST_INDEX" ]]; then
  echo "错误：前端构建不存在，无法启动生产模式。请先运行：cd frontend && npm run build" >&2
  exit 1
fi

echo "[4/4] 启动 StudyPlusPlus：http://$HOST:$PORT"
echo "按 Ctrl+C 停止服务"
echo

cd backend
exec env STUDY_DATA_DIR="$ROOT_DIR/data" ../.venv/bin/uvicorn \
  app.main:app --host "$HOST" --port "$PORT"
