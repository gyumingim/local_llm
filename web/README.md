# 웹 UI (FastAPI + Vite React)

브라우저에서 `agent/codeact_agent.py` (에이전트)를 실행한다. 대화 모드는 없다 (2026-10-16 제거).

- `codeact_agent.py`를 하위 프로세스로 띄우고 (`AGENT_JSON=1`) 단계·토큰·관찰을 로그로 보여 준다. 작업 폴더는 `agent/workspace` (`AGENT_WORKSPACE`로 바꿈).

## 실행
```bash
# 1) 백엔드 (터미널 1)
cd web/backend
pip install -r requirements.txt
uvicorn main:app --port 8010

# 2) 프론트엔드 (터미널 2)
cd web/frontend
npm install
npm run dev        # http://localhost:5173
```

모델은 커스텀 모델 `qwen3-coder-cline:30b` 만 쓸 수 있다 (바꾸려면 `WEB_MODELS=a,b`).

환경변수: `OLLAMA_HOST` (기본 `http://localhost:11434`), `AGENT_WORKSPACE`, `WEB_TIMEOUT_MIN` (에이전트 강제 종료, 기본 60분).

주의: 에이전트는 서버 PC에서 파이썬 코드를 실행한다. 다른 PC에 열 때는 신뢰하는 네트워크에서만 쓴다.
