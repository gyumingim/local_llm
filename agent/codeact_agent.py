"""
CodeAct 에이전트 — 개선판 (mini-swe-agent / smolagents 교훈 반영)
행동을 단일 Python 코드 블록으로 통일 → 커스텀 도구 형식 파싱 문제 제거.
- CodeAct(2402.01030): 실행가능 코드가 곧 행동
- mini-swe-agent: 단일 도구, 명확한 종료, no-progress 감지
- 파일 생성/편집/실행/테스트 전부 python 코드로. persistent 세션(변수 유지), cwd=workspace.
실행: python agent/codeact_agent.py "태스크"
"""
import io, sys, os, re, json, contextlib, traceback, urllib.request

OLLAMA = "http://localhost:11434/api/chat"
MODEL = "qwen3-coder-cline:30b"
BASE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE = os.path.join(BASE, "workspace")
os.makedirs(WORKSPACE, exist_ok=True)

SYSTEM = """You are a coding agent. You act ONLY by writing Python code.
Each turn respond in this format:
Thought: <short reasoning>
```python
<code to run>
```
Rules:
- The code runs in a PERSISTENT python session, current directory = workspace.
- Create or edit files with open(path, 'w'); read with open(path).read().
- To edit part of a file: read it, modify the string, write it back.
- Verify by running/importing your code and print(...) the result.
- Keep each code block small and focused (one step).
When the task is DONE and you verified it works, respond with NO code block:
Thought: done
FINAL: <one-line summary>
"""


def call_ollama(messages):
    body = json.dumps({"model": MODEL, "messages": messages, "stream": False,
                       "options": {"temperature": 0.2, "num_ctx": 32768}}).encode()
    req = urllib.request.Request(OLLAMA, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)["message"]["content"]


def extract_code(text):
    m = re.search(r"```(?:python)?\s*\n(.*?)```", text, re.DOTALL)
    return m.group(1) if m else None


def execute(code, ns):
    """persistent namespace에서 코드 실행, stdout/stderr/에러 반환"""
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            exec(code, ns)
        out = buf.getvalue().strip()
        return out[:1500] if out else "(no output)"
    except Exception:
        return (buf.getvalue() + "\n" + traceback.format_exc()).strip()[-1200:]


def run(task, max_steps=15):
    os.chdir(WORKSPACE)  # 파일 작업을 workspace로 격리
    ns = {"__name__": "__agent__"}
    messages = [{"role": "system", "content": SYSTEM},
                {"role": "user", "content": f"Task: {task}"}]
    recent = []
    for step in range(max_steps):
        out = call_ollama(messages)
        print(f"\n--- Step {step+1} ---\n{out.strip()[:500]}")
        messages.append({"role": "assistant", "content": out})
        if "FINAL:" in out:
            return out.split("FINAL:")[-1].strip()
        code = extract_code(out)
        if not code:
            messages.append({"role": "user", "content": "Observation: no code block found. Write a ```python block or FINAL:."})
            continue
        # no-progress 감지 (mini-swe-agent 교훈)
        dup = code.strip() in recent[-2:]
        recent.append(code.strip())
        obs = execute(code, ns)
        print(f"[Observation] {obs[:250]}")
        note = "\n(Note: you repeated the same code. Try a different approach.)" if dup else ""
        messages.append({"role": "user", "content": f"Observation:\n{obs}{note}"})
    return "(max steps reached)"


if __name__ == "__main__":
    task = sys.argv[1] if len(sys.argv) > 1 else \
        "Create sq.py defining square(n) returning n+n (a bug, should be n*n). Run square(5) to see 10. Fix ONLY the return line to n*n by reading/editing the file. Re-run to verify 25."
    print("TASK:", task)
    print("\n=== RESULT ===\n" + run(task))
