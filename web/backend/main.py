# 로컬 LLM 웹 서버 (FastAPI)
# - /api/models : Ollama 모델 목록
# - /api/agent  : agent/codeact_agent.py 를 하위 프로세스로 실행하고 이벤트를 SSE 로 흘림 (VS Code 확장과 같은 방식)
# - /api/stop/{run_id} : 실행 중인 에이전트 중단
# 실행: cd web/backend && uvicorn main:app --port 8010
import json
import os
import subprocess
import sys
import threading
import urllib.request
import uuid

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

OLLAMA_HOST = (os.environ.get("OLLAMA_HOST") or "http://localhost:11434").rstrip("/")
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CODEACT = os.path.join(ROOT, "agent", "codeact_agent.py")
WORKSPACE = os.path.abspath(os.environ.get("AGENT_WORKSPACE") or os.path.join(ROOT, "agent", "workspace"))
# 웹에서 쓸 수 있는 모델 = 우리가 만든 커스텀 모델만 (SETUP.md 의 ollama create). 쉼표로 여러 개 지정 가능
ALLOWED = [m.strip() for m in os.environ.get("WEB_MODELS", "qwen3-coder-cline:30b").split(",") if m.strip()]

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
        try:
            with open(p, encoding="utf-8") as fh:
                content = fh.read(20000)
        except (OSError, UnicodeDecodeError):
            content = "(텍스트 파일 아님)"
        files.append({"path": os.path.relpath(p, WORKSPACE).replace("\\", "/"), "content": content})
    return files


def sse(obj):
    return "data: " + json.dumps(obj, ensure_ascii=False) + "\n\n"


class AgentReq(BaseModel):
    model: str
    task: str
    history: str = ""


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


@app.post("/api/agent")
def agent(req: AgentReq):
    check_model(req.model)
    run_id = uuid.uuid4().hex[:8]
    env = {**os.environ, "AGENT_JSON": "1", "AGENT_MODEL": req.model, "AGENT_HISTORY": req.history,
           "AGENT_WORKSPACE": WORKSPACE, "OLLAMA_HOST": OLLAMA_HOST, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
    proc = subprocess.Popen([sys.executable, CODEACT, req.task], cwd=WORKSPACE if os.path.isdir(WORKSPACE) else ROOT,
                            env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, encoding="utf-8", errors="replace")
    RUNS[run_id] = proc
    before = snapshot()
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
