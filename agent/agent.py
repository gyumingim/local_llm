"""
통합 코딩 에이전트 — 로드맵 모든 기법 결합
- ReAct(2210.03629)         : Thought->Action->Observation 루프
- CodeAct(2402.01030)       : python 코드 실행
- SWE-agent(2405.15793)     : 안전한 코드편집 도구(workspace 격리)
- Reflexion(2303.11366)     : 실패 시 자기반성 재시도
- Voyager(2305.16291)       : 스킬 라이브러리(저장/재사용)
- Plan-and-Solve(2305.04091): 먼저 계획 수립
- Codebase Memory           : 의미 검색(indexer, nomic 임베딩)
실행: python agent/agent.py "태스크"
"""
import json, sys, re, os, subprocess, textwrap, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

OLLAMA = "http://localhost:11434/api/chat"
MODEL = "qwen3-coder-cline:30b"
BASE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE = os.path.join(BASE, "workspace")
SKILLS_FILE = os.path.join(BASE, "skills.json")
os.makedirs(WORKSPACE, exist_ok=True)


def _safe(path):
    full = os.path.abspath(os.path.join(WORKSPACE, path.strip().strip('`').strip('"')))
    if not full.startswith(os.path.abspath(WORKSPACE)):
        raise ValueError("workspace 밖 접근 금지")
    return full


def _clean(arg):
    """모델이 넣는 '|' 블록·다양한 라벨·펜스 제거 (파싱 견고화)"""
    arg = re.sub(r"^\|\s*\n?", "", arg.strip())
    arg = re.sub(r"^\s*(Action Input|Content|Code|File|Path)\s*:\s*", "", arg, flags=re.M | re.I)
    return arg


def tool_create_file(arg):
    arg = _clean(arg)
    parts = arg.split("\n", 1)
    path = parts[0].strip().strip('`').strip('"')
    content = re.sub(r"^\s*```\w*\s*$", "", (parts[1] if len(parts) > 1 else "").strip("\n"), flags=re.M)  # 모든 펜스 라인 제거
    content = content.replace("\r\n", "\n").replace("\r", "\n")  # CRLF 정규화
    content = textwrap.dedent(content)                            # 모델의 공통 선행 들여쓰기 제거
    content = re.sub(r'\n\s*(```|""")\s*$', '', content)          # 끝에 남은 고립 펜스/삼중따옴표 제거
    full = _safe(path)
    d = os.path.dirname(full)
    if d and d != os.path.abspath(WORKSPACE):
        os.makedirs(d, exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        f.write(content + "\n")
    return f"created {path} ({len(content)} chars)"


def tool_view_file(arg):
    with open(_safe(arg), encoding="utf-8") as f:
        lines = f.readlines()
    return "".join(f"{i+1}: {l}" for i, l in enumerate(lines))[:2000]


def tool_run_python(arg):
    try:
        r = subprocess.run([sys.executable, _safe(arg)], capture_output=True, text=True, timeout=30, cwd=WORKSPACE)
        return (r.stdout + r.stderr).strip()[:1500] or "(no output)"
    except Exception as e:
        return f"Error: {e}"


def tool_save_skill(arg):
    arg = _clean(arg)
    parts = arg.split("\n", 1)
    name = parts[0].strip().strip('`').strip('"')
    code = re.sub(r"^```\w*\s*|\s*```$", "", (parts[1] if len(parts) > 1 else "").strip("\n"))
    skills = json.load(open(SKILLS_FILE, encoding="utf-8")) if os.path.exists(SKILLS_FILE) else {}
    skills[name] = code
    json.dump(skills, open(SKILLS_FILE, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    return f"saved skill '{name}' ({len(skills)} total)"


def tool_use_skill(arg):
    skills = json.load(open(SKILLS_FILE, encoding="utf-8")) if os.path.exists(SKILLS_FILE) else {}
    return skills.get(arg.strip(), "skill not found")


def tool_search_codebase(arg):
    """indexer의 의미 검색 (사전에 indexer.py index 필요)"""
    try:
        from indexer import search as cb_search
        rows = cb_search(arg.strip())
        return "\n".join(f"{n} ({f}:{ln}) sim={s}" for n, f, ln, s in rows) or "no matches"
    except Exception as e:
        return f"Error (run 'python agent/indexer.py index' first): {e}"


TOOLS = {"create_file": tool_create_file, "view_file": tool_view_file,
         "run_python": tool_run_python, "save_skill": tool_save_skill,
         "use_skill": tool_use_skill, "search_codebase": tool_search_codebase}

SYSTEM = """You are an autonomous coding agent (sandbox = 'workspace' folder).
You: PLAN first, then ACT step by step, LEARN from failures, and SAVE reusable skills.

Tools:
- create_file: FIRST line = path, following lines = content. No '|', quotes, or fences.
- view_file: Action Input = path.
- run_python: run a py file. Action Input = path.
- save_skill: FIRST line = skill name, following lines = code.
- use_skill: Action Input = skill name.
- search_codebase: semantic search over indexed code. Action Input = query.

FIRST message: write a short numbered PLAN (Plan-and-Solve).
THEN each step in EXACTLY this format:
Thought: <reasoning>
Action: <tool>
Action Input: <input>

Wait for Observation. If it shows an error, reflect why and fix (Reflexion).
When the task is done AND verified by running:
Thought: done
Final Answer: <summary>
"""


def call_ollama(messages):
    body = json.dumps({"model": MODEL, "messages": messages, "stream": False,
                       "options": {"stop": ["Observation:"], "temperature": 0.3}}).encode()
    req = urllib.request.Request(OLLAMA, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)["message"]["content"]


def is_failure(obs):
    return any(k in obs for k in ("Error", "Traceback", "Exception", "not found"))


def run(task, max_steps=20):
    skills = json.load(open(SKILLS_FILE, encoding="utf-8")) if os.path.exists(SKILLS_FILE) else {}
    hint = ("Saved skills: " + ", ".join(skills)) if skills else "No saved skills yet."
    messages = [{"role": "system", "content": SYSTEM},
                {"role": "user", "content": f"{hint}\n\nTask: {task}"}]
    for step in range(max_steps):
        out = call_ollama(messages)
        print(f"\n--- Step {step+1} ---\n{out.strip()[:600]}")
        messages.append({"role": "assistant", "content": out})
        if "Final Answer:" in out:
            return out.split("Final Answer:")[-1].strip()
        # Action Input은 다음 키워드(Action/Thought/Observation) 전까지만 (여러 액션 오염 방지)
        m = re.search(r"Action:\s*(\w+).*?Action Input:\s*(.+?)(?=\n(?:Action|Thought|Observation)\s*:|\Z)", out, re.DOTALL)
        if not m:
            # 계획만 있고 액션 없으면 실행하라고 유도
            messages.append({"role": "user", "content": "Observation: (no action) Now execute your plan step by step."})
            continue
        tool, arg = m.group(1).strip(), m.group(2).strip()
        try:
            obs = TOOLS.get(tool, lambda x: f"unknown tool: {tool}")(arg)
        except Exception as e:
            obs = f"Error: {e}"
        print(f"[Observation] {obs[:250]}")
        note = "\n\n[Reflexion] It failed. Reflect why, then fix." if is_failure(obs) else ""
        messages.append({"role": "user", "content": f"Observation: {obs}{note}"})
    return "(max steps reached)"


if __name__ == "__main__":
    task = sys.argv[1] if len(sys.argv) > 1 else \
        "Create fib.py with a fibonacci(n) function, run it to print the first 10 Fibonacci numbers, and save it as skill 'fibonacci'."
    print("TASK:", task)
    print("\n=== RESULT ===\n" + run(task))
