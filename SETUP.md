# SETUP — 다른 환경에서 동일하게 구축

Python 3.10+ 와 [Ollama](https://ollama.com)만 있으면 됩니다. (에이전트는 표준 라이브러리만 사용, 의존성 설치 불필요)

> 단계별 체크리스트·내 GPU에 맞는 명령은 **[setup.html](setup.html)** (브라우저로 열기). 이 파일은 명령 모음입니다.

## 1. Ollama 설치 + 모델
```bash
# Ollama 설치: https://ollama.com (Windows/Mac/Linux)

# 모델 받기
ollama pull qwen3-coder:30b      # 에이전트 메인 (코딩)
ollama pull nomic-embed-text     # 코드 인덱싱 임베딩
ollama pull gpt-oss:20b          # (선택) 빠른 채팅

# 32K context 버전 생성 (에이전트용 — 기본 4K로는 부족)
printf 'FROM qwen3-coder:30b\nPARAMETER num_ctx 32768\n' > Modelfile
ollama create qwen3-coder-cline:30b -f Modelfile
```

## 1.5 성능 최적화 (flash attention — 권장)
Ollama 속도·메모리 최적화. 환경변수 설정 후 Ollama 재시작 (재부팅해도 유지):
```powershell
# Windows (PowerShell)
[Environment]::SetEnvironmentVariable("OLLAMA_FLASH_ATTENTION","1","User")
[Environment]::SetEnvironmentVariable("OLLAMA_KV_CACHE_TYPE","q8_0","User")
```
```bash
# Linux/Mac (~/.bashrc 또는 ~/.zshrc에 추가)
export OLLAMA_FLASH_ATTENTION=1
export OLLAMA_KV_CACHE_TYPE=q8_0
```
→ VRAM 오프로드 감소, 긴 context 메모리 절반. (근본 속도 한계는 모델 크기 vs VRAM)

## 1.6 듀얼 머신 — 다른 GPU에서 LLM 전담 (경합 회피)
이 컴에서 Isaac Sim/게임 등 무거운 GPU 작업을 같이 돌리면 LLM과 VRAM 경합해서 느려집니다.
tailscale로 연결된 **다른 컴(예: 4060)에 LLM을 전담**시키면 경합이 사라집니다.
(⚠️ tailscale 너머 tensor-parallel로 두 GPU를 묶는 건 대역폭 병목이라 비추 — 역할 분리가 정답)

```bash
# LLM 담당 컴(예: 4060, 8GB)에서: Ollama가 원격 접속 받게 노출 + 모델 설치
#   OLLAMA_HOST=0.0.0.0:11434 로 serve (systemd 환경변수 또는 실행 시)
ollama pull qwen2.5-coder:7b     # 8GB에 fit하는 코딩 특화 (30B는 8GB엔 안 들어감)

# 개발 컴에서: codeact가 원격 LLM 컴을 가리키게
export OLLAMA_HOST=http://<타컴_tailscale_IP>:11434
export AGENT_MODEL=qwen2.5-coder:7b
python agent/codeact_agent.py "태스크"
```
- Isaac Sim 등을 **안 돌릴 땐** `OLLAMA_HOST`를 빼면 이 컴의 30B(최고품질)를 그대로 씁니다.
- Kilo도 Providers → Base URL을 `http://<타컴_IP>:11434/v1`, Model `qwen2.5-coder:7b`로 바꾸면 됨.

## 2. 에이전트 실행
```bash
# 권장: CodeAct 방식 (행동=python 코드, 파싱문제 없음)
python agent/codeact_agent.py "Create a bubble sort and test it"

# 커스텀 도구판 (create_file/edit_file/skill/search)
python agent/agent.py "태스크"

# 코드베이스 의미검색
python agent/indexer.py index
python agent/indexer.py search "함수 설명 쿼리"
```

## 3. (선택) 웹서치·벡터DB 백엔드 — Docker
```bash
# SearXNG (무제한·무료 로컬 웹서치)
mkdir searxng
docker run -d --name searxng -p 8888:8080 -v "$PWD/searxng:/etc/searxng" searxng/searxng
# searxng/settings.yml 에 아래 추가 후 docker restart searxng:
#   search:
#     formats: [html, json]

# Qdrant (Kilo 코드 인덱싱용)
docker run -d --name qdrant -p 6333:6333 qdrant/qdrant
```

## 4. (선택) 실사용 IDE — Kilo Code
- VS Code 확장 `kilocode.Kilo-Code` 설치
- Providers → Custom → **OpenAI Compatible**, Base URL `http://localhost:11434/v1`, Model `qwen3-coder-cline:30b`
  (⚠️ Ollama 전용 provider가 없으면 OpenAI Compatible + `/v1` 사용)
- Indexing 탭: Ollama `nomic-embed-text` + Qdrant `http://localhost:6333`

## 모델별 하드웨어 기준
| 모델 | VRAM | 비고 |
|---|---|---|
| qwen3-coder:30b (Q4) | 16GB+ (또는 12GB+RAM 오프로드) | 에이전트 메인, ~59 tok/s |
| gpt-oss:20b | 16GB (완전 fit) | ~160 tok/s |
| nomic-embed-text | ~1GB | 임베딩 |

## 구조
```
agent/
  codeact_agent.py   # CodeAct(권장) — 단일 코드 도구
  agent.py           # 통합(커스텀 도구 + Plan + Reflexion + Skill + RAG)
  react_agent.py     # 1단계 ReAct
  coding_agent.py    # 2단계 SWE-agent 도구
  reflexion_agent.py # 3단계 Reflexion
  voyager_agent.py   # 4단계 스킬 라이브러리
  indexer.py         # 5단계 코드 인덱싱(임베딩)
research/agent-papers.md  # 논문 11편 정리
```

## 5. 웹 UI (FastAPI + Vite React) — 브라우저에서 에이전트 쓰기
필요: Python 3.10+, Node.js 18+, 위 1번의 `qwen3-coder-cline:30b` 모델 (웹은 이 커스텀 모델만 허용).
이미지 읽기(`see_image`)는 비전 모델이 필요하다: `ollama pull qwen2.5vl:7b` (다른 모델은 `VISION_MODEL` 로). 그림 그리기는 `pip install matplotlib`.
웹서치를 쓰려면 3번 SearXNG 도 켜 둔다 (날씨 `get_weather` 는 SearXNG 없이 인터넷만 있으면 됨).
```bash
# 백엔드 (터미널 1)
cd web/backend
pip install -r requirements.txt
python -m uvicorn main:app --port 8010

# 프론트엔드 (터미널 2)
cd web/frontend
npm install
npm run dev          # → http://localhost:5173
```
- 웹은 `OLLAMA_HOST` 를 지정하지 않으면 이 컴의 Ollama(`http://localhost:11434`)를 쓴다.
- ⚠️ `agent/codeact_agent.py` 를 **명령줄에서 직접** 돌릴 때는 기본 `OLLAMA_HOST` 가 karma(tailscale) 주소이고
  기본 모델도 이 저장소에 없는 모델이다. 새 컴에서는 꼭 지정한다:
  `OLLAMA_HOST=http://localhost:11434 AGENT_MODEL=qwen3-coder-cline:30b python agent/codeact_agent.py "태스크"`
- 재부팅 뒤: Docker Desktop 켜기 → `docker start searxng` (자동 시작 원하면 `docker update --restart unless-stopped searxng`).
- 자세한 것: `web/README.md`.
