"""
코딩 에이전트 — 로드맵 2단계 (SWE-agent ACI, arXiv 2405.15793)
ReAct 루프 + 안전한 코드편집 도구셋. workspace/ 안에서만 작업(격리).
실행: python agent/coding_agent.py "태스크"
"""
import json, sys, re, os, subprocess, urllib.request
try:
    import sys
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except:
    pass

OLLAMA = "http://localhost:11434/api/chat"
MODEL = "qwen3-coder-cline:30b"
WORKSPACE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "workspace")
os.makedirs(WORKSPACE, exist_ok=True)


def _safe(path):
    """workspace 밖 접근 차단 (SWE-agent: guardrail)"""
    full = os.path.abspath(os.path.join(WORKSPACE, path.strip().strip('`').strip('"')))
    if not full.startswith(os.path.abspath(WORKSPACE)):
        raise ValueError("workspace 밖 접근 금지")
    return full


def tool_create_file(arg):
    parts = arg.split("\n", 1)
    path = parts[0].strip().strip('`').strip('"')
    content = parts[1] if len(parts) > 1 else ""
    content = re.sub(r"^```\w*\s*|\s*```$", "", content.strip("\n"))
    full = _safe(path)
    d = os.path.dirname(full)
    if d and d != os.path.abspath(WORKSPACE):
        os.makedirs(d, exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        f.write(content + "\n")
    return f"created {path} ({len(content)} chars)"


def tool_view_file(arg):
    full = _safe(arg)
    with open(full, encoding="utf-8") as f:
        lines = f.readlines()
    return "".join(f"{i+1}: {l}" for i, l in enumerate(lines))[:2000]


def tool_run_python(arg):
    full = _safe(arg)
    try:
        r = subprocess.run([sys.executable, full], capture_output=True, text=True, timeout=30, cwd=WORKSPACE)
        return (r.stdout + r.stderr).strip()[:1500] or "(no output)"
    except Exception as e:
        return f"Error: {e}"


def tool_search_code(arg):
    q = arg.strip()
    hits = []
    for root, _, files in os.walk(WORKSPACE):
        for fn in files:
            p = os.path.join(root, fn)
            try:
                for i, line in enumerate(open(p, encoding="utf-8")):
                    if q in line:
                        hits.append(f"{os.path.relpath(p, WORKSPACE)}:{i+1}: {line.strip()}")
            except Exception:
                pass
    return "\n".join(hits[:15]) or "no matches"


TOOLS = {"create_file": tool_create_file, "view_file": tool_view_file,
         "run_python": tool_run_python, "search_code": tool_search_code}

SYSTEM = """You are a coding agent working inside a sandbox 'workspace' folder.
Tools:
- create_file: create/overwrite a file. Action Input: FIRST line = path, REST = file content.
- view_file: show a file with line numbers. Action Input: path.
- run_python: run a python file and see output. Action Input: path.
- search_code: search text in workspace. Action Input: query.

Answer ONE step at a time in EXACTLY this format:
Thought: <reasoning>
Action: <one tool name>
Action Input: <input>

Then STOP and wait for Observation. When the task is done AND verified by running:
Thought: done
Final Answer: <summary>
"""


def call_ollama(messages):
    body = json.dumps({"model": MODEL, "messages": messages, "stream": False,
                       "options": {"stop": ["Observation:"], "temperature": 0.3}}).encode()
    req = urllib.request.Request(OLLAMA, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)["message"]["content"]


def run(task, max_steps=10):
    messages = [{"role": "system", "content": SYSTEM},
                {"role": "user", "content": f"Task: {task}"}]
    for step in range(max_steps):
        out = call_ollama(messages)
        print(f"\n--- Step {step+1} ---\n{out.strip()}")
        messages.append({"role": "assistant", "content": out})
        if "Final Answer:" in out:
            return out.split("Final Answer:")[-1].strip()
        m = re.search(r"Action:\s*(\w+).*?Action Input:\s*(.+)", out, re.DOTALL)
        if not m:
            messages.append({"role": "user", "content": "Observation: invalid format, use Thought/Action/Action Input."})
            continue
        tool, arg = m.group(1).strip(), m.group(2).strip()
        try:
            obs = TOOLS.get(tool, lambda x: f"unknown tool: {tool}")(arg)
        except Exception as e:
            obs = f"Error: {e}"
        print(f"[Observation] {obs[:300]}")
        messages.append({"role": "user", "content": f"Observation: {obs}"})
    return "(max steps reached)"


if __name__ == "__main__":
    task = sys.argv[1] if len(sys.argv) > 1 else \
        "Create factorial.py with a factorial(n) function, then run it to print factorial(5)."
    print("TASK:", task)
    print("\n=== RESULT ===\n" + run(task))
