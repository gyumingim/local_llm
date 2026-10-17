# Local LLM 코딩 에이전트

내 PC의 GPU에서 돌아가는 **로컬 LLM 코딩 에이전트**입니다. 인터넷 AI 서비스나 API 키 없이 쓸 수 있습니다.
브라우저 화면에서 일을 시키면 에이전트가 **파이썬 코드를 직접 쓰고 실행하면서** 결과를 확인한 뒤 답합니다.

> 처음 설치한다면 **[setup.html](setup.html)** 을 브라우저로 여세요. 내 GPU에 맞는 모델 고르기부터 실행까지 단계별 체크리스트로 안내합니다.
> (명령만 보고 싶으면 [SETUP.md](SETUP.md))

---

## 할 수 있는 것

| 기능 | 예시 요청 | 쓰는 것 |
|---|---|---|
| 프로그램 만들기·실행·고치기 | "구구단 출력하는 프로그램 짜줘" | 코딩 모델 + 파이썬 실행 |
| 만든 파일 내려받기 | 답 아래 **⬇ 다운로드** | 웹 UI |
| 웹 검색 (출처 링크 포함) | "최신 파이썬 버전 찾아줘" | SearXNG |
| 날씨 | "부산 내일 비 와?" | Open-Meteo |
| 이미지 검색해서 보여 주기 | "드론 이미지 3개 찾아줘" | SearXNG 이미지 검색 |
| 이미지 읽기 (글자·표·사진) | 이미지 붙여 넣고 "뭐라고 써 있어?" | 비전 모델 |
| 그래프·그림 그리기 | "sin 그래프 그려줘" | matplotlib |

답마다 걸린 시간과 단계 수(⏱ 9.7초 · 2단계)가 표시되고, 펼치면 에이전트가 단계별로 무엇을 했는지 작업 로그를 볼 수 있습니다.

---

## 빠른 시작

자세한 설명은 [setup.html](setup.html). 아래는 Windows 기준 요약입니다.

```powershell
# 1. 모델 (Ollama 설치 후)
ollama pull qwen3-coder:30b
ollama pull qwen2.5vl:7b
"FROM qwen3-coder:30b`nPARAMETER num_ctx 32768" | Out-File -Encoding ascii Modelfile
ollama create qwen3-coder-cline:30b -f Modelfile

# 2. 웹 검색 엔진 (Docker 설치 후) — settings.yml 은 setup.html 4단계 참고
docker run -d --name searxng --restart unless-stopped -p 8888:8080 -v "$HOME/searxng:/etc/searxng" searxng/searxng

# 3. 백엔드 (터미널 1)
cd web/backend
pip install -r requirements.txt matplotlib
python -m uvicorn main:app --port 8010

# 4. 프론트엔드 (터미널 2)
cd web/frontend
npm install
npm run dev
# → http://localhost:5173
```

---

## 스택

### 한눈에 보기

```
 브라우저 (http://localhost:5173)
   │  Vite + React — 입력창, 작업 로그, 이미지·파일 표시
   │  /api/* 요청은 Vite 가 백엔드로 넘김
   ▼
 FastAPI 백엔드 (:8010)
   │  요청마다 에이전트를 하위 프로세스로 실행하고, 진행 상황을 SSE 로 실시간 전달
   ▼
 CodeAct 에이전트 (agent/codeact_agent.py, 파이썬 표준 라이브러리만 사용)
   │  ① 모델에게 "다음에 실행할 파이썬 코드"를 쓰게 함
   │  ② 그 코드를 agent/workspace 에서 실행
   │  ③ 실행 결과를 모델에게 다시 보여 줌 → FINAL 답이 나올 때까지 반복
   ├──▶ Ollama (:11434)   코딩 모델 qwen3-coder-cline:30b, 비전 모델 qwen2.5vl:7b
   ├──▶ SearXNG (:8888)   웹·이미지 검색 (Docker)
   └──▶ Open-Meteo        날씨 (키 없는 무료 API, 인터넷만 있으면 됨)
```

### 구성 요소별 설명

| 구성 요소 | 역할 | 왜 이걸 골랐나 |
|---|---|---|
| **[Ollama](https://ollama.com)** | 내 GPU에서 LLM을 돌리는 실행기. `localhost:11434` 에 HTTP API를 연다 | 설치가 쉽고, 모델 받기(`pull`)·설정 바꾼 모델 만들기(`create`)가 명령 하나. Windows/Mac/Linux 지원 |
| **CodeAct 에이전트** (`agent/codeact_agent.py`) | 에이전트의 두뇌 루프. 외부 패키지 없이 파이썬 표준 라이브러리만 사용 | 도구를 "정해진 글 형식"으로 부르게 하면 로컬 모델이 형식을 자주 틀림(파싱 문제). 파이썬 코드를 쓰게 하면 형식 문제가 사라지고 도구를 if/for 로 엮을 수 있음 — [CodeAct 논문](https://arxiv.org/abs/2402.01030), mini-swe-agent, smolagents 와 같은 방식 ([research/agent-papers.md](research/agent-papers.md) 6·11절) |
| **FastAPI** (`web/backend/main.py`) | 웹 API 서버. 에이전트 실행, 진행 상황 스트리밍(SSE), 이미지 업로드, 파일 내려주기 | 파이썬이라 에이전트와 같은 언어. 의존성이 `fastapi`, `uvicorn` 둘뿐 |
| **Vite + React** (`web/frontend/`) | 채팅 화면. 실제 코드는 `src/App.jsx` 한 파일 | 개발 서버가 빠르고 설정이 거의 없음. `/api` 요청을 백엔드로 넘기는 프록시 내장 |
| **SearXNG** | 웹·이미지 검색. 검색어를 구글·빙·덕덕고 등에 대신 보내 결과를 모아 JSON 으로 줌 | 무료, API 키 없음, 횟수 제한 없음, 검색 기록이 외부에 남지 않음. Docker 로 한 줄 실행 |
| **Open-Meteo** | 현재 날씨 + 3일 예보 | 무료, 키 없음. 도시 이름은 영어로 찾음(서울 → `Seoul`) |
| **qwen2.5vl:7b** | 이미지 읽기(사진 설명, 글자·표 옮겨 적기) | 코딩 모델은 글만 이해함. 에이전트가 `see_image()` 로 이 모델에게 대신 물어봄 |
| **matplotlib** | 그래프·그림을 `.png` 로 저장 → 화면에 자동 표시 | 파이썬 표준 그래프 라이브러리 |

### 에이전트가 쓸 수 있는 도구 함수

모두 파이썬 함수로 미리 넣어 두었고, 모델은 코드 안에서 그냥 부릅니다(`import` 필요 없음).

| 함수 | 하는 일 |
|---|---|
| `web_search(query)` | SearXNG 웹 검색 → 제목·URL·요약 |
| `fetch_url(url)` | 웹 페이지 본문 텍스트 (검색 요약만으로 부족할 때) |
| `get_weather(city)` | 실시간 날씨 + 3일 예보 (city 는 영어) |
| `image_search(query, k)` | 이미지 검색 → `workspace/images/` 에 내려받음 → 화면에 표시 |
| `see_image(path, question)` | 비전 모델로 이미지 읽기 |
| `run_py(path)` | `.py` 파일을 별도 프로세스로 실행 (30초 제한) |
| `grep_code(pattern)` / `search_codebase(query)` | 작업 폴더 코드 검색 (정규식 / 의미 검색) |
| `save_skill(name, code)` / `use_skill(name)` | 자주 쓰는 코드를 저장·재사용 |

---

## 어떤 모델을 써야 하나

### 역할별

| 역할 | 기본 모델 | 크기 | 필수? |
|---|---|---|---|
| 에이전트 (코딩·판단) | **`qwen3-coder-cline:30b`** = `qwen3-coder:30b` + 컨텍스트 32K | 18 GB | **필수** — 웹 UI는 기본으로 이 모델만 허용 |
| 이미지 읽기 | **`qwen2.5vl:7b`** | 6 GB | 이미지 기능을 쓸 때 |
| 코드 의미 검색 | `nomic-embed-text` | 0.3 GB | `search_codebase()` 를 쓸 때만 |

- `qwen3-coder:30b` 는 전문가 혼합(MoE) 모델이라 30B 지만 한 번에 일부만 계산해서 빠릅니다(RTX 5080 에서 약 60 tok/s).
- Ollama 기본 컨텍스트는 4K 라 여러 단계를 거치면 앞 내용을 잊습니다. 그래서 `num_ctx 32768` 로 늘린 **커스텀 모델 `qwen3-coder-cline:30b`** 를 만들어 씁니다(빠른 시작 1단계). Kilo·Cline 같은 다른 도구는 이 32K 를 그대로 쓰고, 이 에이전트는 요청마다 `AGENT_NUM_CTX`(기본 8192)로 정해서 씁니다 — 속도와 메모리를 위해서이며, 긴 작업이면 늘리세요.
- 비전 모델은 2026-10 에 `qwen3-vl:8b` 와 비교했을 때 한글 표 옮겨 적기·사진 설명 모두 `qwen2.5vl:7b` 가 더 정확하고 약 3배 빨라서 그대로 두었습니다(테스트 이미지 2장 기준). 바꾸려면 `VISION_MODEL=qwen3-vl:8b`.

### GPU 메모리(VRAM)별 추천

| VRAM | 에이전트 모델 | 비고 |
|---|---|---|
| **24 GB 이상** | `qwen3-coder-cline:30b` | 모델이 GPU에 다 들어감. 가장 쾌적 |
| **16 GB** (RTX 4080/5080 등) | `qwen3-coder-cline:30b` | 일부가 시스템 RAM으로 넘어가지만 MoE 라 충분히 빠름. 개발에 쓴 환경 |
| **8–12 GB** | `qwen2.5-coder:7b` (같은 방법으로 32K 커스텀 모델을 만들어 씀) | 정확도는 떨어짐. 웹 UI에서 쓰려면 `WEB_MODELS=<모델 이름>` |
| GPU 없음 | 비추천 | CPU 로도 돌지만 단계마다 수십 초 이상 |

> 이미지 기능을 같이 쓰면 비전 모델(6 GB)도 VRAM 을 씁니다. 16 GB 에서는 Ollama 가 두 모델을 번갈아 올려서 이미지를 처음 읽을 때 몇십 초 느릴 수 있습니다.

### 성능 설정 (권장)

```powershell
# Windows — 설정 후 Ollama 를 다시 시작
[Environment]::SetEnvironmentVariable("OLLAMA_FLASH_ATTENTION","1","User")
[Environment]::SetEnvironmentVariable("OLLAMA_KV_CACHE_TYPE","q8_0","User")
```
긴 컨텍스트의 메모리 사용이 절반 정도로 줄어듭니다.

---

## 사용법

### 웹 UI (권장)
- 입력창에 시키고 Enter. 이미지는 **Ctrl+V 붙여 넣기 · 끌어다 놓기 · 📎**.
- 왼쪽 사이드바에 대화 목록이 남습니다(이 브라우저에만 저장, 최근 50개). 답은 마크다운(목록·표·코드)으로 보입니다.
- 에이전트가 만든 파일은 답 아래 **📄 파일명 ⬇ 다운로드**, 이미지는 썸네일(누르면 크게).
- 답 안의 코드 상자는 **복사 / ⬇ 저장** 버튼이 있습니다.
- 작업 파일은 모두 `agent/workspace/` 에 쌓입니다(올린 이미지는 `uploads/`, 검색한 이미지는 `images/`).

### 명령줄
```bash
# 새 PC 에서는 OLLAMA_HOST 와 AGENT_MODEL 을 꼭 지정 (아래 '알려진 한계' 참고)
OLLAMA_HOST=http://localhost:11434 AGENT_MODEL=qwen3-coder-cline:30b \
  python agent/codeact_agent.py "Create a bubble sort function and test it"

# 실제 프로젝트 폴더에서 작업시키기
AGENT_WORKSPACE=/path/to/project python agent/codeact_agent.py "Fix the bug in foo.py and run the tests"

# 품질 측정 (회귀 테스트)
python agent/benchmark.py
```

### VS Code 확장
`agent-extension/` — 사이드바에서 같은 에이전트를 씁니다. 설치·설정은 [agent-extension/README.md](agent-extension/README.md).

### 환경변수

| 이름 | 기본값 | 설명 |
|---|---|---|
| `OLLAMA_HOST` | 웹: `http://localhost:11434` | Ollama 주소 (다른 PC 의 GPU 를 쓸 때) |
| `WEB_MODELS` | `qwen3-coder-cline:30b` | 웹 UI 에서 고를 수 있는 모델 (쉼표로 여러 개) |
| `VISION_MODEL` | `qwen2.5vl:7b` | 이미지 읽기 모델 |
| `AGENT_WORKSPACE` | `agent/workspace` | 에이전트 작업 폴더 |
| `AGENT_MAX_STEPS` | `60` | 단계 상한 |
| `AGENT_NUM_CTX` | `8192` | 에이전트가 요청하는 컨텍스트 길이 |
| `WEB_TIMEOUT_MIN` | `60` | 웹에서 에이전트 강제 종료 시간(분) |

---

## 안전장치

에이전트는 **이 PC에서 실제로 파이썬 코드를 실행**합니다. 아래 장치가 있지만 완전한 격리(샌드박스)는 아닙니다.

- 작업 폴더는 `agent/workspace/` (실행 위치를 여기로 고정)
- `subprocess`, `os.system`, `os.remove`, `shutil.rmtree` 등 삭제·시스템 명령 차단
- 코드 실행 25초, `run_py` 30초 제한 / 단계 상한 60 / 같은 코드 반복·연속 실패 시 자동 정리 후 종료
- 웹 API 의 파일 내려받기는 작업 폴더 밖 경로(`../`)를 막음
- 웹 UI 는 기본적으로 내 PC(`localhost`)에서만 열림. **다른 사람에게 주소를 열어 주지 마세요.**

---

## 폴더 구조

```
agent/
  codeact_agent.py     ⭐ 메인 에이전트 (웹 UI·VS Code 확장이 이것을 실행)
  agent.py             통합 에이전트 (커스텀 도구판)
  react_agent.py …     논문별 단계 구현 (아래 표)
  indexer.py           코드 의미 검색 인덱서
  benchmark.py         자체 벤치마크
web/
  backend/main.py      FastAPI 서버
  frontend/src/App.jsx React 화면
agent-extension/       VS Code 확장
research/agent-papers.md  참고 논문 정리
setup.html             설치 안내 (브라우저로 열기)
SETUP.md               설치 명령 모음
```

### 학습용: 논문 하나 → 기능 하나

이 프로젝트는 에이전트 논문의 기법을 하나씩 직접 구현하면서 시작했습니다. 최종 결론이 `codeact_agent.py` 입니다.

| 파일 | 논문 | 기능 |
|---|---|---|
| `react_agent.py` | ReAct (2210.03629) | 생각 → 행동 → 관찰 루프 |
| `coding_agent.py` | SWE-agent (2405.15793) | 작업 폴더 안 코드 편집 도구 |
| `reflexion_agent.py` | Reflexion (2303.11366) | 실패하면 반성하고 다시 시도 |
| `voyager_agent.py` | Voyager (2305.16291) | 스킬 저장·재사용 |
| `indexer.py` | Codebase Memory | AST 추출 + 임베딩 검색 |
| `agent.py` | Plan-and-Solve 통합 | 위 기능을 커스텀 도구로 결합 |
| **`codeact_agent.py`** ⭐ | **CodeAct + mini-swe-agent** | **행동을 파이썬 코드로 통일** — 도구 형식 파싱 문제가 사라져 가장 안정적 |

**검증:** `agent/benchmark.py` 20종(알고리즘·자료구조·여러 파일·SWE-bench 식 디버깅) **20/20 통과** (2026-07, [STATUS.md](STATUS.md)).

---

## 알려진 한계

- 명령줄로 `codeact_agent.py` 를 직접 실행하면 기본 Ollama 주소가 개발자의 다른 PC(tailscale)로 되어 있습니다. 새 PC 에서는 `OLLAMA_HOST`·`AGENT_MODEL` 을 지정하세요. 웹 UI 는 상관없습니다.
- SearXNG 는 다른 검색엔진의 결과를 모으므로, 요약이 예전 것이거나 엉뚱한 이미지가 섞일 수 있습니다.
- 로컬 30B 모델은 간단한 작업도 가끔 단계를 반복합니다. 반복 감지·자동 종료가 있지만 완벽하지 않습니다.
- 큰 실제 저장소(수백 파일) 수정은 아직 약합니다.
