# 로컬 LLM 코딩 에이전트

Ollama 로컬 모델 위에, 주요 에이전트 **논문의 기법을 단계적으로 직접 구현**한 학습용 코딩 에이전트.
외부 의존성 없이 Python 표준 라이브러리만 사용.

## 스택
- **모델**: Ollama — `qwen3-coder-cline:30b`(에이전트, 32K ctx), `gpt-oss:20b`(빠름), `qwen2.5vl:7b`(비전)
- **웹서치**: SearXNG (Docker, `localhost:8888`) — 무제한·무료·로컬
- **임베딩**: `nomic-embed-text` (코드 의미 검색)
- **벡터DB**: Qdrant (Docker, `localhost:6333`) — Kilo 인덱싱용

## 에이전트 (단계별 구현 = 논문 하나 → 기능 하나)
| 파일 | 논문 | 기능 | 자체검증 |
|---|---|---|---|
| `agent/react_agent.py` | ReAct (2210.03629) | Thought→Action→Observation 루프 | 1234×5678=7006652 |
| `agent/coding_agent.py` | SWE-agent (2405.15793) | 안전한 코드편집 도구(workspace 격리) | factorial(5)=120 |
| `agent/reflexion_agent.py` | Reflexion (2303.11366) | 실패 시 자기반성→재시도 | 10/0 에러→10/2=5.0 |
| `agent/voyager_agent.py` | Voyager (2305.16291) | 스킬 라이브러리(저장·재사용) | is_prime 재사용 |
| `agent/indexer.py` | Codebase Memory | ast 추출 + 임베딩 의미검색 | run_python 검색 |
| **`agent/agent.py`** | **통합** (+ Plan-and-Solve, CodeAct) | 위 전부 결합 | fibonacci 전과정 |

## 사용법
```bash
# 통합 에이전트 (권장)
python agent/agent.py "Create a bubble sort function and test it"

# 코드베이스 인덱싱 후 의미 검색
python agent/indexer.py index
python agent/indexer.py search "function that runs a file safely"

# 단계별 에이전트도 개별 실행 가능
python agent/react_agent.py "질문"
```

## 안전장치
- 모든 파일 작업은 `agent/workspace/` 안으로 제한 (밖 접근 차단)
- 코드 실행은 subprocess + 30초 timeout
- 파싱 견고화: 모델의 `|`/`Content:`/펜스/들여쓰기/CRLF 자동 정리

## 논문 정리
[research/agent-papers.md](research/agent-papers.md) — 10편 핵심 아이디어 + 적용 포인트

## 진행 로드맵
- [x] 1~5단계 + 통합 에이전트 (모두 자체검증 통과)
- [ ] Self-Refine (Final Answer 전 자기검토) — 선택
- [ ] MemGPT 스타일 context 요약 (긴 작업) — 선택
- [ ] Tree of Thoughts 다중경로 탐색 — 선택
