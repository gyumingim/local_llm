"""
CodeAct 에이전트 — 개선판 (mini-swe-agent / smolagents 교훈 반영)
행동을 단일 Python 코드 블록으로 통일 → 커스텀 도구 형식 파싱 문제 제거.
- CodeAct(2402.01030): 실행가능 코드가 곧 행동
- mini-swe-agent: 단일 도구, 명확한 종료, no-progress 감지
- 파일 생성/편집/실행/테스트 전부 python 코드로. persistent 세션(변수 유지), cwd=workspace.
실행: python agent/codeact_agent.py "태스크"
"""
import io, sys, os, re, json, threading, contextlib, traceback, urllib.request
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows cp949 콘솔 유니코드 출력 크래시 방지
except Exception:
    pass

OLLAMA = "http://localhost:11434/api/chat"
MODEL = os.environ.get("AGENT_MODEL", "qwen3-coder-cline:30b")  # AGENT_MODEL로 교체 가능
BASE = os.path.dirname(os.path.abspath(__file__))
# 실사용: AGENT_WORKSPACE로 실제 작업 디렉토리 지정 가능 (기본은 격리된 workspace)
WORKSPACE = os.path.abspath(os.environ.get("AGENT_WORKSPACE", os.path.join(BASE, "workspace")))
os.makedirs(WORKSPACE, exist_ok=True)
SKILLS_FILE = os.path.join(BASE, "skills.json")
SEARXNG = "http://localhost:8888/search"


def _web_search(query, k=3):
    """namespace에 주입 — 에이전트가 코드에서 web_search(...) 호출 (SearXNG 로컬)"""
    import urllib.parse
    try:
        url = SEARXNG + "?" + urllib.parse.urlencode({"q": query, "format": "json"})
        with urllib.request.urlopen(url, timeout=15) as r:
            data = json.load(r)
        return [{"title": x.get("title"), "url": x.get("url"), "content": (x.get("content") or "")[:200]}
                for x in data.get("results", [])[:k]]
    except Exception as e:
        return f"search error: {e}"


def _load_skills():
    return json.load(open(SKILLS_FILE, encoding="utf-8")) if os.path.exists(SKILLS_FILE) else {}


def _save_skill(name, code):
    skills = _load_skills()
    skills[name] = code
    json.dump(skills, open(SKILLS_FILE, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    return f"saved skill '{name}'"


def _use_skill(name):
    return _load_skills().get(name, f"skill '{name}' not found")


def _run_py(path):
    """파일 실행 전용 (subprocess+timeout) — exec의 import/hang 문제 우회. 멀티파일 실행에 사용."""
    import subprocess
    try:
        r = subprocess.run([sys.executable, path], capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=30, cwd=WORKSPACE)
        return (r.stdout + r.stderr).strip() or "(no output)"
    except Exception as e:
        return f"run error: {e}"


def _search_codebase(query):
    """실제 프로젝트 코드 의미검색(RAG, indexer) — 기존 코드베이스 이해용 (백지 작성과 다른 실무 능력)"""
    try:
        from indexer import search as _s
        rows = _s(query)
        return [{"name": n, "file": f, "line": ln, "code": c[:300]} for n, f, ln, sim, c in rows]
    except Exception as e:
        return f"search error (run 'python agent/indexer.py index' first): {e}"


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
- When parsing text/CSV lines, .strip() each line to remove trailing whitespace/newlines (files may have \\r\\n on Windows).
- Verify by running/importing your code and print(...) the result.
- After writing a .py file, ALWAYS verify it parses: `import ast; ast.parse(open(path,encoding='utf-8').read())`. If SyntaxError, read the file and fix it BEFORE claiming success.
- Keep each code block small and focused (one step). Write a whole file in ONE block (don't split a file across blocks — that causes truncation/syntax errors).
- To ADD to an existing file: in ONE code block, read the whole file, build the new full content string, and write it back — don't stop after just reading.
- Before you say FINAL, you MUST re-read the target file(s) and print them to confirm your change is actually present. Never claim success without seeing the change in the file.
Helpers already available (call directly, no import needed):
- web_search(query) -> list of {title, url, content}   # local SearXNG
- save_skill(name, code_string) -> save reusable code for later
- use_skill(name) -> retrieve a previously saved skill's code (reuse instead of rewriting)
- run_py(path) -> run a .py file in a subprocess and return its output. USE THIS to run/test files (esp. multi-file programs) instead of import.
- search_codebase(query) -> semantic search over the indexed project code; returns [{name,file,line,code}]. Use to understand existing code before modifying.
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
    # 한 응답에 여러 코드 블록이 있으면 모두 연결해 실행 (멀티파일 한 번에 작성 대응)
    blocks = re.findall(r"```(?:python)?\s*\n(.*?)```", text, re.DOTALL)
    return "\n".join(blocks) if blocks else None


def execute(code, ns, timeout=25):
    """persistent namespace에서 코드 실행 (threading timeout으로 무한루프/블로킹 방지)"""
    # 안전 가드: 명백히 위험한 시스템/삭제 명령 차단
    danger = [d for d in ("shutil.rmtree", "os.system", "subprocess", "os.remove", "os.unlink", "rmdir", "os.rmdir") if d in code]
    if danger:
        return f"BLOCKED for safety: {danger} not allowed. Do file read/write within the workspace only."
    result = {"out": "(execution timed out ~25s — likely an infinite loop or a blocking call like input(). Rewrite without it.)"}

    def _target():
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                exec(code, ns)
            o = buf.getvalue().strip()
            result["out"] = o[:1500] if o else "(no output)"
        except Exception:
            result["out"] = (buf.getvalue() + "\n" + traceback.format_exc()).strip()[-1200:]

    t = threading.Thread(target=_target, daemon=True)
    t.start()
    t.join(timeout)
    return result["out"]


def is_failure(obs):
    return any(k in obs for k in ("Error", "Traceback", "Exception", "Assertion", "not found", "BLOCKED"))


def run(task, max_steps=15):
    os.chdir(WORKSPACE)  # 파일 작업을 workspace로 격리
    if WORKSPACE not in sys.path:
        sys.path.insert(0, WORKSPACE)  # workspace 파일끼리 import 가능하게 (멀티파일 조율)
    ns = {"__name__": "__agent__", "web_search": _web_search,
          "save_skill": _save_skill, "use_skill": _use_skill, "run_py": _run_py,
          "search_codebase": _search_codebase}
    _sk = _load_skills()
    _hint = ("\nSaved skills available via use_skill(name): " + ", ".join(_sk)) if _sk else ""
    messages = [{"role": "system", "content": SYSTEM},
                {"role": "user", "content": f"Task: {task}{_hint}"}]
    recent = []
    fail_streak = 0
    for step in range(max_steps):
        # context 압축 (mini-swe-agent 교훈): 오래된 observation을 잘라 context bloat 방지
        if len(messages) > 12:
            for msg in messages[2:-6]:
                if msg["role"] == "user" and len(msg["content"]) > 180:
                    msg["content"] = msg["content"][:150] + " ...(truncated to save context)"
        out = call_ollama(messages)
        print(f"\n--- Step {step+1} ---\n{out.strip()[:500]}")
        messages.append({"role": "assistant", "content": out})
        if "FINAL:" in out:
            # Self-Refine 제거: 로컬 30B에서 self-review가 완료를 방해(무한 개선 유도)하고
            # 엣지케이스 개선 효과도 없어 순해로움 → 바로 종료 (실패 기반 개선)
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
        if is_failure(obs):
            fail_streak += 1
            if fail_streak >= 6:  # 무한 반복 방지 (no-progress 조기 종료)
                return f"(gave up after {fail_streak} consecutive failures — likely stuck)"
        else:
            fail_streak = 0
        note = "\n(Note: you repeated the same code. Try a different approach.)" if dup else ""
        messages.append({"role": "user", "content": f"Observation:\n{obs}{note}"})
    return "(max steps reached)"


if __name__ == "__main__":
    task = sys.argv[1] if len(sys.argv) > 1 else \
        "Create sq.py defining square(n) returning n+n (a bug, should be n*n). Run square(5) to see 10. Fix ONLY the return line to n*n by reading/editing the file. Re-run to verify 25."
    print("TASK:", task)
    print("\n=== RESULT ===\n" + run(task))
