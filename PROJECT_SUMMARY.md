# 프로젝트 요약 (Project Summary)

이 프로젝트는 LLM 기반 코딩 에이전트 연구 및 파인튜닝을 위한 도구 모음입니다. 다양한 에이전트 아키텍처(ReAct, Reflexion, Voyager 등)를 구현하고 벤치마킹하며, 최종적으로 모델을 미세 조정(Fine-tuning)하는 파이프라인으로 구성됩니다.

## 1. 코딩 에이전트 모듈 (Agent Modules)
`agent/` 디렉토리에 위치하며, 단계별로 발전된 다양한 에이전트 아키텍처를 포함합니다.

### 통합 에이전트 (`agent.py`)
- **특징**: 로드맵의 모든 기법을 결합한 최종 통합 버전입니다. 파일 생성, 수정, 실행, 스킬 저장/사용 등 포괄적인 도구 집합을 제공합니다.
- **핵심 기능**: `_safe`, `tool_create_file`, `call_ollama` 등

### CodeAct 에이전트 (`codeact_agent.py`)
- **특징**: `mini-swe-agent`와 `smolagents`의 교훈을 반영한 개선판입니다. 코드 실행과 검색 능력이 강화되었습니다.
- **핵심 기능**: `_run_py`, `_search_codebase`, `extract_code` 등

### Voyager 에이전트 (`voyager_agent.py`)
- **특징**: arXiv 2305.16291(Voyager)을 구현한 에이전트로, 스킬 저장 및 재사용(`_save_skill`, `_use_skill`)을 통해 장기적 학습 능력을 갖추고 있습니다.

### Reflexion 에이전트 (`reflexion_agent.py`)
- **특징**: arXiv 2303.11366(Reflexion) 기반의 자기 반성(Self-reflection) 에이전트입니다. 실패 시 피드백을 통해 코드를 수정하며 작업을 진행합니다.

### Coding 에이전트 (`coding_agent.py`)
- **특징**: arXiv 2405.15793(SWE-agent ACI)를 구현한 버전으로, 코드베이스 탐색(`tool_search_code`)에 특화되어 있습니다.

### ReAct 에이전트 (`react_agent.py`)
- **특징**: arXiv 2210.03629(ReAct)의 미니 구현체입니다. Thought-Action-Observation 루프를 통해 웹 검색과 파일 읽기를 수행합니다.

## 2. 파인튜닝 및 데이터 (Fine-tuning & Data)
`finetune/` 디렉토리에 위치하며, 모델을 도메인 특화 방식으로 학습시키는 도구들입니다.

### 데이터 생성 (`gen_data.py`)
- **기능**: Self-instruct 방식을 사용하여 LLM이 스스로 데이터를 생성합니다. 파인튜닝용 훈련 데이터를 자동으로 구축하는 역할을 합니다.

### 모델 학습 (`train.py`)
- **기능**: Unsloth 라이브러리를 활용한 QLoRA 파인튜닝을 수행합니다. 효율적인 메모리 사용으로 모델을 빠르게 미세 조정할 수 있습니다.

## 3. 유틸리티 및 도구 (Utilities & Tools)

### 벤치마킹 (`benchmark.py`)
- **기능**: 정의된 태스크들을 `codeact_agent`로 실행하여 에이전트의 성능을 측정합니다. 성공 마커를 기준으로 자동 채점을 수행합니다.

### 코드베이스 인덱싱 (`indexer.py`)
- **기능**: arXiv 2405.x(Codebase Memory/RAG) 관련 기능입니다. 프로젝트 디렉토리를 임베딩하여 코사인 유사도 기반의 검색을 가능하게 합니다.

### 프로젝트 맵 생성 (`tools/project_map.py`)
- **기능**: MemGPT 스타일의 외부 메모리 시스템으로, 프로젝트 구조를 요약하여 MD 파일로 압축 저장합니다. 에이전트가 프로젝트 맥락을 파악하는 데 사용됩니다.
