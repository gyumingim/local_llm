# STATUS

## 전체 목표
로컬 LLM을 구축하여 기존 오픈소스 VSCode 익스텐션(Cline/Continue)에 연결해
"Claude처럼 만능"에 최대한 근접한 무료·프라이버시 코딩 환경 구성.

## 세부 목표 (2026-07-08 사용자 방향 재확정)
- **핵심 = "Claude처럼 대화·코딩하는 에이전트"를 이 하드웨어에서.** 자동완성은 곁가지.
- 5080 컴(이 머신) = 메인 에이전트 모델 (Cline + Qwen3-Coder 30B)
- karma(4060) = 자동완성 보조 서버 (우선순위 낮음, 이미 세팅됨)

## 사용 기술
- 런타임: Ollama 0.30.11 (이미 설치됨, OpenAI 호환 API, 멀티GPU 자동분할)
- 익스텐션: Cline(에이전트) + Continue(자동완성)
- 모델 후보: gpt-oss:20b / Qwen3-Coder 30B A3B / qwen2.5-coder(자동완성)

## 하드웨어 (확인 완료 2026-07-08)
- 이 컴(rtx5080, tailscale 100.92.214.97): RTX 5080 16GB, 드라이버 591.74, CUDA 13.1,
  RAM 63GB(39GB 여유), Ryzen 7 7800X3D 8코어, Windows 11 Pro
- tailscale 노드: karma(linux, 온라인) / 123(linux, 70일째 offline)
- 4060 8GB 컴: tailscale 상 명확한 온라인 노드 미확인 (karma 여부 확인 필요)

## 성능 기대치 (근거: SWE-bench Verified)
- 로컬 30B급 ≈ 51.6% (Claude Opus 4.8 88.6%의 절반~60% 수준)
- 자동완성/코드설명/단순코딩 = 실용적, 복잡한 자율 에이전트 = 감독 필수

## 했던 일
- [x] 자료조사: 런타임/익스텐션/모델/멀티GPU/성능 벤치마크 (2026-07-08)
- [x] 이 컴 환경 확인 (GPU/드라이버/RAM/Ollama/tailscale)
- [x] 5080 모델 pull: qwen3-coder:30b(18GB), gpt-oss:20b(13GB)
- [x] 에이전트용 32K context 모델 생성: qwen3-coder-cline:30b (num_ctx 32768)
- [x] karma(4060) 세팅: ollama OLLAMA_HOST=0.0.0.0 바인딩 + qwen2.5-coder:1.5b-base pull
- [x] 5080→karma ollama 접근 확인 (http://100.126.163.103:11434, plink+hostkey 경유)
- [x] Cline 확장 ID 확정: saoudrizwan.claude-dev

## 하고 있는 일
- Cline 설치 막힘: VSCode 실행파일이 new_Code.exe/old_Code.exe로 남음(업데이트 미완료)
  → 사용자가 VSCode 재실행해야 Code.exe 복구됨

## 추가 기능 (2026-07-08 전부 세팅 완료)
- [x] Cline 설치 (Code.exe 복사본으로 CLI 우회) + Ollama 연결(사용자 GUI 완료)
- [x] 웹서치: SearXNG(Docker, 포트 8888, JSON 활성) 무제한무료 + mcp-searxng 등록
      → Cline MCP 설정: %APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json
- [x] 사진인식: qwen2.5vl:7b (6GB) — 실제 이미지 묘사 검증 완료
- [x] 태스크분리: Kilo Code v7.4.1 설치 (Orchestrator 모드)
- [x] RAG(지식주입): Continue v2.0.0 + nomic-embed-text + config.yaml(@codebase)
      → ~/.continue/config.yaml — chat=5080/자동완성=karma/embed=5080
- [x] 방향교정: 파인튜닝→RAG (지식주입엔 RAG가 정답), LangChain/LangGraph 불필요(오버킬)

## 남은 사용자 GUI 액션 (내가 클릭 불가)
1. VSCode "Developer: Reload Window" → 새 확장/설정 인식
2. Cline: MCP searxng 서버 뜨는지 확인 (웹서치 도구)
3. Kilo: Ollama 연결(Cline과 동일값) + Orchestrator 모드
4. Continue: @codebase 인덱싱 자동시작 확인
5. 비전: Cline/Continue에 이미지 첨부해서 사용

## 실사용 성능 최적화 (2026-07-09, 벤치 매몰 탈피 → 당장 쓸 AI 집중)
- 실측(실무 코딩 프롬프트):
  - qwen3-coder-cline:30b: **67 tok/s**(flash attention 후), 코딩특화·정확 → **에이전트 코딩 메인**
  - gpt-oss:20b: **162 tok/s**, 빠르고 품질 준수 → **빠른 채팅/Ask·Plan**
  - gpt-oss:120b: 17.6 tok/s (RAM 오프로드 심함) → 실사용 제외
- flash attention + KV q8_0 적용(env User): 오프로드 34%→29%, SIZE 22→20GB (근본 한계는 weight 18GB > VRAM 16GB = 하드웨어)
- **Kilo 최적 배치**: Code/Debug/Orchestrator=qwen3-coder-cline:30b, Ask/Plan=gpt-oss:20b
- flash attention User env 영구 설정(재부팅 유지). 실사용 스택 완성: 모델+flash+Kilo(200)+SearXNG/Qdrant
- 파인튜닝 실험 결론: **자기생성 데이터 파인튜닝은 성능↑ 비효율**(model collapse 위험 + 30B는 16GB로 불가). finetune/는 파이프라인 기록만
- **최적 전략(결론)**: 일상=로컬(공짜·빠름, qwen3-coder 67tok/s) / 어려운 것=하이브리드(GLM $12.6mo or Claude). 로컬 5080으론 Claude급 지능 불가(하드웨어)

## 최종 스택 = Kilo Code 하나 + Ollama (Cline/Continue 제거)
- Kilo Ollama 연결: Custom provider, OpenAI Compatible, http://localhost:11434/v1, qwen3-coder-cline:30b
- [x] ② Rules: .kilocode/rules/00-principles.md (HARNESS 원칙 자동 적용)
- [x] ③ 웹서치: .kilocode/mcp.json (searxng MCP)
- [x] ⑤ Ollama 튜닝: OLLAMA_FLASH_ATTENTION=1, OLLAMA_KV_CACHE_TYPE=q8_0 (User env, 재시작 후 적용)
- [x] ① Indexing 백엔드: Qdrant(Docker, 6333) + nomic-embed-text
- [ ] ⑥ gpt-oss:120b pull 진행 중 (65GB)
- 남은 GUI: Indexing 탭 설정, Model per Mode, VSCode 리로드(Rules/MCP 인식), Ollama 재시작(120b 후)

## 접근 정보 (엔드포인트)
- 5080(메인): http://localhost:11434 — qwen3-coder-cline:30b, gpt-oss:20b, gpt-oss:120b, qwen2.5vl:7b, nomic-embed-text
- karma(4060): http://100.126.163.103:11434 — qwen2.5-coder:1.5b-base (자동완성)
- SearXNG: http://localhost:8888 / Qdrant: http://localhost:6333 (Docker)

## 논문 기반 에이전트 구축 (2026-07-08, 자율 진행)
목표: 주요 에이전트 논문 기법을 Ollama 위에 단계적으로 직접 구현 (학습 + 나만의 에이전트).
- [x] 논문 10편 조사·정리: research/agent-papers.md
  (ReAct/Reflexion/Toolformer/SWE-agent/Voyager/CodeAct/Plan-and-Solve/ToT/Self-Refine/MemGPT)
- [x] 1단계 ReAct: agent/react_agent.py — 검증 1234×5678=7006652
- [x] 2단계 SWE-agent 코드편집: agent/coding_agent.py — 검증 factorial(5)=120
- [x] 3단계 Reflexion: agent/reflexion_agent.py — 검증 10/0에러→10/2=5.0
- [x] 4단계 Voyager 스킬: agent/voyager_agent.py — 검증 is_prime 저장·재사용
- [x] 5단계 코드인덱싱: agent/indexer.py — 검증 의미검색(run_python)
- [x] 통합 에이전트: agent/agent.py — 검증 fibonacci(plan+생성+실행+스킬)
- [x] README.md 작성
- [x] 스트레스 테스트: 다중파일(calc 모듈 + test_calc 어서션) 작성·실행 → PASS
- [x] 실전 디버깅 테스트: bubble_sort 작성·실행·검증 → SORTED_OK
- 해결한 버그: 파싱오염(| / Content: / 펜스 / 다중Action / 끝삼중따옴표), dedent, CRLF, 좀비 llama-server OOM
- 파싱 핵심: Action Input은 다음 키워드 전까지만 캡처 + 모든 펜스라인 제거 + dedent + CRLF정규화
- [x] 실전교훈 반영: CodeAct 에이전트(codeact_agent.py) — 행동=python코드로 통일, 파싱지옥 해결
  (mini-swe-agent 100줄 74% / smolagents 분석). 검증: 버그픽스5·Stack4·다중파일CLI6·웹서치+quicksort
- [x] web_search/save_skill 헬퍼 namespace 주입 + context압축 + 안전가드(rmtree/os.system 차단)
- [x] benchmark.py: **20종 20/20 (100%, UnicodeError 0)** — 단일15 + 멀티파일·플러그인·stdlib·TODO앱 + SWE-bench식 디버깅(multifile_debug)
- [x] **강화 사이클4(연쇄 실패)**: 사이클3(codeact stdout utf-8)이 benchmark cp949 캡처를 깨뜨림 → subprocess encoding=utf-8
      → "한 강화가 다른 곳을 깨뜨리는" 실제 개발 연쇄를 벤치로 발견·수정. gcd/mfdebug/todo 전부 복구
- [x] 효율 계측: **평균 2.1 steps/task**(에이전트 프롬프트 이미 효율적), 131s/task(느림=5080 16GB에 30B 오프로드, 하드웨어)
      → 장기벤치(40분) 중 Ollama 일시장애 발견 → run_task에 1회 재시도 추가(계측 안정화)
- [x] **강화 사이클2 (실패 기반)**: multifile FAIL → 원인 3개(여러 코드블록 누락 / sys.path에 workspace 없음 / exec import hang)
      → 강화: extract_code 모든블록 추출 + sys.path.insert(WORKSPACE) + run_py 헬퍼(subprocess+timeout)
- [x] **강화 사이클3**: 플러그인·stdlib 태스크 추가 → 전부 통과(18/18). **강화 후 로컬 30B가 자기완결적 태스크 사실상 다 감당**
      → 진짜 한계는 SWE-bench식 대규모 실제 저장소(수십 파일·실제 프레임워크·긴 컨텍스트) — 별도 인프라 필요
- [x] **강화 사이클(실패 기반)**: csv_parse timeout 발견 → 원인: exec에 timeout 없어 무한루프 hang + Self-Refine이 완료 방해
      → 강화 4종: exec threading timeout(25s) / Self-Refine 제거 / fail_streak(6회 조기종료) / strip 힌트
      → 결과: csv/debug/파서(expr,json) 전부 통과. **로컬 30B가 파서 구현까지 강함**
- [x] SETUP.md: 다른 환경 재현 가이드
- 커밋 6개 (Initial 제외 5개 작업 커밋)
- [x] Self-Refine(완료 전 자기검토 1회): 명시적 요구 검증엔 유효.
  단, **로컬 30B는 self-critique가 약해 미묘한 엣지케이스(빈 입력 등) 자동개선은 제한적**
  (프롬프트 강화해도 avg([]) 크래시 미인지 — Self-Refine 논문은 GPT-4 기준. 정직한 한계)
- 남은 개선(선택): MemGPT context요약, ToT/LATS 트리탐색
- 검증 요약: 벤치 4/4(100%) + 버그픽스·클래스·다중파일·웹서치·quicksort 전부 통과

## 접근 정보 (karma)
- ssh: karma@karma (비밀번호는 저장소에 적지 않음 — 따로 보관)
- ollama: http://100.126.163.103:11434 (tailscale, 같은 LAN 2ms)

## 문제점 및 해결방안
- 문제: 두 GPU가 별도 머신(tailscale). 네트워크는 PCIe보다 수백배 느려
  llama.cpp RPC 풀링 비실용적.
  해결: 각 머신 독립 운영. 5080=메인, 4060=자동완성 보조(선택).
- 문제: 16GB 단독으론 30B A3B Q4(19GB) 초과.
  해결: MoE 특성 + RAM 39GB 여유로 일부 CPU 오프로드 가능. 또는 gpt-oss:20b(14GB fit).
