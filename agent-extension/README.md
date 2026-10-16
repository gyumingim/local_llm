# Local Agent

로컬 LLM(Ollama + Qwen3.6-35B)으로 코딩을 돕는 VS Code 채팅 확장입니다.
**codeact 방식**으로 도구를 실행하기 때문에, 로컬 모델에서도 파일 편집·실행이 안정적으로 동작합니다
(일반적인 function-calling 방식은 로컬 모델이 형식을 자주 틀립니다).

## 기능

- 💬 채팅으로 코드 작성·편집·실행 (현재 워크스페이스에서)
- ⚡ 실시간 토큰 스트리밍 + 생성중 표시(경과시간·토큰수)
- 💭 사고 과정 토글 — 기본은 **답변만** 깔끔하게, 버튼으로 과정 on/off
- 📁 대화 저장·목록·복원 (실수로 지워지지 않음)
- 📎 파일 첨부 (버튼 + **드래그 앤 드롭**)
- 🎨 VS Code 네이티브 테마 (에디터 테마를 그대로 따름)
- ⊟ 사이드바 / 에디터 탭(넓게) 양쪽 지원

## 요구 사항

- **Python 3.10+**
- **Ollama** + 코딩 모델 (기본: `qwen3.6:35b` 또는 `hf.co/unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q3_K_M`)
- `codeact_agent.py` (이 저장소의 `agent/` 폴더)

## 설정

VS Code 설정에서:
- `localAgent.codeactPath` — `codeact_agent.py` 절대경로
- `localAgent.pythonPath` — Python 실행 파일 (기본 `python`)

원격 Ollama를 쓰려면 codeact의 `OLLAMA_HOST` 환경변수로 지정합니다
(예: 다른 GPU 컴퓨터 = `http://<IP>:11434`).

## 사용

1. 활동바의 🤖 아이콘 → 채팅 패널
2. 작업 입력 (예: `utils.py에 add(a,b) 추가하고 테스트해줘`)
3. 넓게 쓰려면 패널 우측 상단 **⊟** → 에디터 탭

## 라이선스

MIT
