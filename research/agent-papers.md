# 코딩 에이전트 핵심 논문 정리 + 적용 로드맵

> 목적: 논문의 아이디어를 우리 로컬 스택(Ollama + Python)에 단계적으로 구현해
> "나만의 개발 에이전트"를 만든다. 각 논문은 "한 편 읽고 → 기능 하나 구현" 원칙으로 연결.

---

## 공통 루프 (거의 모든 에이전트가 이 변형)

```
목표 → 계획 → Tool 선택 → 실행 → 결과 확인 → (실패? 반성→다시계획 / 성공? 완료)
```
여기에 얹는 것: 장기 메모리 · Context 압축 · Sub-agent · 코드 그래프 · 테스트 자동화

---

## 1. ReAct — 에이전트 루프의 기초
- arXiv: https://arxiv.org/abs/2210.03629 (2022)
- **핵심**: Reasoning(생각)과 Acting(행동)을 번갈아 생성. 생각은 계획·예외처리, 행동은 외부(검색·환경) 접근.
- **루프**: Thought(상황분석·계획) → Action(검색/실행) → Observation(결과) → 반복.
- **성과**: CoT의 환각·오류전파를 외부 도구 상호작용으로 극복. ALFWorld +34%, WebShop +10%.
- **우리 적용**: 에이전트 코어 = `while: 모델에게 Thought+Action 생성시키기 → Action 파싱·실행 → Observation 다시 주입`. **가장 먼저 구현할 뼈대.**

## 2. Toolformer — 도구를 언제/어떻게 쓸지
- arXiv: https://arxiv.org/abs/2302.04761 (Meta)
- **핵심**: LM이 self-supervised로 API 호출(어떤 도구·언제·인자·결과활용)을 스스로 학습. 계산기·QA·검색·번역·달력.
- **우리 적용**: 도구 스키마 정의 + 모델이 도구 호출을 텍스트로 생성 → 파서가 실행. (파인튜닝까진 불필요, 프롬프트로 도구 목록 제공)

## 3. Reflexion — 실패에서 배우기 (자기반성)
- arXiv: https://arxiv.org/abs/2303.11366
- **핵심**: weight 업데이트 없이 **언어적 피드백**으로 강화. 환경의 이진/스칼라 피드백을 텍스트 요약으로 바꿔 episodic memory에 저장 → 다음 시도의 추가 context.
- **효과**: 코드 생성 벤치 SOTA. 실패를 "의미적 gradient"로 활용.
- **우리 적용**: 도구 실행/테스트 실패 시 → 모델에게 "왜 실패했는지 반성문 작성" → 그 반성을 다음 루프 context에 주입 → 자동 재시도.

## 4. SWE-agent — 코드 편집용 인터페이스(ACI)
- arXiv: https://arxiv.org/abs/2405.15793 (Princeton)
- **핵심**: Linux shell의 복잡한 행동공간 대신, 에이전트 전용 **간단한 도구셋**(파일 보기/검색/편집) + 실수 방지 guardrail + 매 턴 간결한 피드백.
- **성과**: SWE-bench 3.8%→12.5% (당시 SOTA). ACI 설계가 성능을 크게 좌우.
- **우리 적용**: 도구를 `view_file`, `search_code`, `edit_file`, `run_test`처럼 **좁고 안전하게** 설계. shell 그대로 주지 말 것.

## 5. Voyager — 스킬 라이브러리 (장기 메모리)
- arXiv: https://arxiv.org/abs/2305.16291 (Minecraft)
- **핵심**: ① 자동 커리큘럼 ② **실행가능 코드의 스킬 라이브러리**(복잡 행동 저장·검색) ③ 환경피드백·에러·자기검증 반복 프롬프트.
- **효과**: 스킬이 조합가능·재사용 → 능력 복리 증가, catastrophic forgetting 완화.
- **우리 적용**: 에이전트가 자주 쓰는 코드/절차를 함수로 저장 → 다음에 검색해 재사용 (임베딩 검색). "한 번 푼 문제 다시 안 풀기".

## 6. CodeAct — 행동을 "실행 코드"로 통일
- arXiv: https://arxiv.org/abs/2402.01030 (ICML 2024)
- **핵심**: JSON 도구호출 대신 **실행가능 Python 코드**를 단일 행동공간으로. Python 인터프리터 연동, 관찰 보고 코드 수정.
- **장점**: 기존 라이브러리 활용 + if/for/데이터흐름으로 여러 도구를 한 행동에 조합. 성공률 +20%.
- **우리 적용**: 도구를 JSON으로 하나씩 부르지 말고, 모델이 **Python 코드 블록**을 쓰게 하고 샌드박스 실행 → 결과 관찰. 표현력↑.

## 7. Plan-and-Solve — 계획 먼저 (missing-step 에러 방지)
- arXiv: https://arxiv.org/abs/2305.04091
- **핵심**: "Let's think step by step" 대신 **먼저 문제를 이해하고 계획(하위태스크 분할)** → 계획대로 실행. 계산·누락 에러 감소.
- **우리 적용**: 에이전트가 태스크 시작 시 **번호 매긴 PLAN**을 먼저 세우고 그다음 실행.

## 8. Tree of Thoughts — 탐색적 사고 (backtrack)
- arXiv: https://arxiv.org/abs/2305.10601
- **핵심**: 중간 사고를 트리 노드로. 여러 후보 사고 생성 → 평가 → BFS/DFS 탐색, 막히면 backtrack.
- **우리 적용**: 어려운 문제에서 한 경로만 파지 말고 여러 접근 생성·비교(고급, 선택적).

## 9. Self-Refine — 자기피드백 개선
- arXiv: https://arxiv.org/abs/2303.17651
- **핵심**: 생성 → 스스로 피드백 → 개선, 반복. 학습 없이 단일 LLM이 generator·critic·refiner 역할. 코드 최적화 +8.7.
- **우리 적용**: Final Answer 전에 "결과를 스스로 검토·개선".

## 10. MemGPT — 계층적 메모리 (긴 작업)
- arXiv: https://arxiv.org/abs/2310.08560
- **핵심**: OS 가상메모리처럼 main context(RAM) ↔ external storage(디스크)를 함수호출로 페이징. 긴 대화·문서에서 context 한계 극복.
- **우리 적용**: 긴 작업 시 오래된 대화를 요약해 external로 내리고, 필요할 때 검색해 올림(고급).

---

## 우리 프로젝트 적용 로드맵 (한 편 = 한 기능)

| 단계 | 논문 | 구현할 기능 | 검증 |
|---|---|---|---|
| **1** | ReAct | Ollama + Python으로 Thought→Action→Observation 루프 | 간단 질문에 도구 써서 답 |
| **2** | CodeAct/Toolformer | 행동을 Python 코드로, 샌드박스 실행 | 파일 읽기/계산을 코드로 |
| **3** | SWE-agent | 안전한 코드편집 도구셋(ACI) | 파일 한 줄 수정 성공 |
| **4** | Reflexion | 실패 시 반성→재시도 | 틀린 코드 자동 교정 |
| **5** | Voyager | 스킬 라이브러리(재사용 코드 메모리) | 반복 작업 재사용 |
| **6** | Codebase Memory | tree-sitter 코드 인덱싱 + 임베딩 검색 | "이 함수 어디?" 답 |

**핵심 원칙(사용자 로드맵)**: 논문 하나 읽고 → 바로 기능 하나 구현 → 실제 코드로 연결.
이렇게 하면 이해도↑ + 단계적으로 나만의 에이전트 완성.

---

## 스택
- 모델: Ollama (qwen3-coder-cline:30b / gpt-oss:20b)
- 언어: Python (에이전트 루프·도구·샌드박스)
- 참고 구현: OpenHands, Cline, Continue 소스 (실제 프롬프트·ACI 설계 확인용)
