# 로컬 LLM 웹 서버 (FastAPI)
# - /api/models : Ollama 모델 목록
# - /api/agent  : agent/codeact_agent.py 를 하위 프로세스로 실행하고 이벤트를 SSE 로 흘림 (VS Code 확장과 같은 방식)
# - /api/upload : 이미지 첨부를 workspace/uploads 에 저장
# - /api/file   : workspace 파일 내려주기 (이미지 미리보기)
# - /api/stop/{run_id} : 실행 중인 에이전트 중단
# 실행: cd web/backend && uvicorn main:app --port 8010
import base64
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.request
import uuid

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

OLLAMA_HOST = (os.environ.get("OLLAMA_HOST") or "http://localhost:11434").rstrip("/")
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CODEACT = os.path.join(ROOT, "agent", "codeact_agent.py")
WORKSPACE = os.path.abspath(os.environ.get("AGENT_WORKSPACE") or os.path.join(ROOT, "agent", "workspace"))
UPLOADS = os.path.join(WORKSPACE, "uploads")
# 웹에서 쓸 수 있는 모델 = 우리가 만든 커스텀 모델만 (SETUP.md 의 ollama create). 쉼표로 여러 개 지정 가능
ALLOWED = [m.strip() for m in os.environ.get("WEB_MODELS", "qwen3-coder-cline:30b").split(",") if m.strip()]
IMAGE_EXT = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp")
MAX_UPLOAD = 20 * 1024 * 1024

app = FastAPI(title="local_llm web")
RUNS: dict[str, subprocess.Popen] = {}  # 실행 중인 에이전트 (중단용)


def snapshot():
    """workspace 파일별 수정 시각 (에이전트가 만든·고친 파일을 찾는 데 씀)."""
    out = {}
    for d, dirs, files in os.walk(WORKSPACE):
        dirs[:] = [x for x in dirs if x not in ("__pycache__", ".git", "node_modules")]
        for n in files:
            p = os.path.join(d, n)
            try:
                out[p] = os.path.getmtime(p)
            except OSError:
                pass
    return out


def changed_files(before):
    files = []
    for p, mt in sorted(snapshot().items()):
        if before.get(p) == mt:
            continue
        rel = os.path.relpath(p, WORKSPACE).replace("\\", "/")
        if p.lower().endswith(IMAGE_EXT):
            files.append({"path": rel, "image": True})
            continue
        try:
            with open(p, encoding="utf-8") as fh:
                content = fh.read(20000)
        except (OSError, UnicodeDecodeError):
            content = "(텍스트 파일 아님)"
        files.append({"path": rel, "content": content})
    return files


def in_workspace(rel):
    """workspace 밖으로 나가는 경로 (../ 등) 차단."""
    p = os.path.abspath(os.path.join(WORKSPACE, rel))
    if os.path.commonpath([p, WORKSPACE]) != WORKSPACE:
        raise HTTPException(400, "workspace 밖 경로")
    return p


def sse(obj):
    return "data: " + json.dumps(obj, ensure_ascii=False) + "\n\n"


class AgentReq(BaseModel):
    model: str
    task: str
    history: str = ""
    images: list[str] = []  # /api/upload 가 돌려준 workspace 상대 경로


class UploadReq(BaseModel):
    name: str
    data: str  # base64 (data URL 앞부분 있어도 됨)


@app.get("/api/models")
def models():
    try:
        with urllib.request.urlopen(OLLAMA_HOST + "/api/tags", timeout=5) as r:
            names = [m["name"] for m in json.load(r)["models"]]
    except Exception as e:
        raise HTTPException(502, f"Ollama 연결 실패 ({OLLAMA_HOST}): {e}")
    return {"models": [n for n in ALLOWED if n in names], "workspace": WORKSPACE}


def check_model(model):
    if model not in ALLOWED:
        raise HTTPException(403, f"허용되지 않은 모델: {model} (허용: {', '.join(ALLOWED)})")


@app.post("/api/upload")
def upload(req: UploadReq):
    stem, ext = os.path.splitext(os.path.basename(req.name) or "image.png")
    if ext.lower() not in IMAGE_EXT:
        raise HTTPException(400, f"이미지만 올릴 수 있음 ({', '.join(IMAGE_EXT)})")
    try:
        raw = base64.b64decode(req.data.split(",", 1)[-1], validate=True)
    except Exception:
        raise HTTPException(400, "base64 아님")
    if len(raw) > MAX_UPLOAD:
        raise HTTPException(413, "20 MB 넘음")
    os.makedirs(UPLOADS, exist_ok=True)
    stem = re.sub(r"[^\w.-]", "_", stem)[:40] or "image"
    name = f"{time.strftime('%m%d_%H%M%S')}_{stem}{ext.lower()}"
    with open(os.path.join(UPLOADS, name), "wb") as fh:
        fh.write(raw)
    return {"path": f"uploads/{name}"}


@app.get("/api/file")
def get_file(path: str, download: bool = False):
    p = in_workspace(path)
    if not os.path.isfile(p):
        raise HTTPException(404, "파일 없음")
    # download=1 이면 브라우저가 열지 않고 내려받게 (Content-Disposition: attachment)
    return FileResponse(p, filename=os.path.basename(p) if download else None)


@app.post("/api/agent")
def agent(req: AgentReq):
    check_model(req.model)
    task = req.task
    imgs = [p for p in req.images if os.path.isfile(in_workspace(p))]
    if imgs:
        task += "\n\n[첨부 이미지 — see_image(path, question) 로 읽어라]\n" + "\n".join(imgs)
    run_id = uuid.uuid4().hex[:8]
    env = {**os.environ, "AGENT_JSON": "1", "AGENT_MODEL": req.model, "AGENT_HISTORY": req.history,
           "AGENT_WORKSPACE": WORKSPACE, "OLLAMA_HOST": OLLAMA_HOST, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1",
           "MPLBACKEND": "Agg", "PYTHONUTF8": "1"}  # 그림은 창 없이 파일로만
    before = snapshot()
    proc = subprocess.Popen([sys.executable, CODEACT, task], cwd=WORKSPACE if os.path.isdir(WORKSPACE) else ROOT,
                            env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, encoding="utf-8", errors="replace")
    RUNS[run_id] = proc
    # 일정 시간 넘으면 강제 종료 (VS Code 확장과 같은 안전장치)
    watchdog = threading.Timer(int(os.environ.get("WEB_TIMEOUT_MIN", "60")) * 60, proc.kill)
    watchdog.start()

    def gen():
        yield sse({"t": "run", "id": run_id})
        final, result, in_result = "", [], False
        try:
            for line in proc.stdout:
                line = line.rstrip("\n")
                if line.startswith("\x1e"):
                    try:
                        yield sse(json.loads(line[1:]))
                    except json.JSONDecodeError:
                        pass
                    continue
                # 답 = 마지막 "=== RESULT ===" 아래 전부 (여러 줄·코드 블록 포함). 없으면 FINAL: 한 줄
                if in_result:
                    result.append(line)
                elif line.startswith("=== RESULT ==="):
                    in_result = True
                elif line.startswith("FINAL:"):
                    final = line[6:].strip()
                yield sse({"t": "line", "d": line})
            code = proc.wait()
            yield sse({"t": "files", "files": changed_files(before)})
            yield sse({"t": "end", "code": code, "final": "\n".join(result).strip() or final})
        finally:
            watchdog.cancel()
            if proc.poll() is None:
                proc.kill()
            RUNS.pop(run_id, None)

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.post("/api/stop/{run_id}")
def stop(run_id: str):
    proc = RUNS.get(run_id)
    if proc and proc.poll() is None:
        proc.kill()
        return {"stopped": True}
    return {"stopped": False}
