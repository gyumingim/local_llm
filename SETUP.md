# SETUP — 다른 환경에서 동일하게 구축

Python 3.10+ 와 [Ollama](https://ollama.com)만 있으면 됩니다. (에이전트는 표준 라이브러리만 사용, 의존성 설치 불필요)

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
