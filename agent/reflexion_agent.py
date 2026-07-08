"""
Reflexion 에이전트 — 로드맵 3단계 (arXiv 2303.11366)
코딩 에이전트(2단계) + 실패 시 언어적 자기반성을 episodic memory에 쌓아 재시도.
실행: python agent/reflexion_agent.py "태스크"
"""
import json, sys, re, os, subprocess, urllib.request
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except:
    pass

OLLAMA = "http://localhost:11434/api/chat"
MODEL = "qwen3-coder-cline:30b"
WORKSPACE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "workspace")
os.makedirs(WORKSPACE, exist_ok=True)


def _safe(path):
    full = os.path.abspath(os.path.join(WORKSPACE, path.strip().strip('`').strip('"')))
    if not full.startswith(os.path.abspath(WORKSPACE)):
        raise ValueError("workspace 밖 접근 금지")
    return full


def tool_create_file(arg):
    arg = arg.strip()
    arg = re.sub(r"^\|\s*\n?", "", arg)                    # YAML '|' 블록 제거
    arg = re.sub(r"^\s*Action Input:\s*", "", arg, flags=re.M)  # 중복 라벨 제거
    parts = arg.split("\n", 1)
    path = parts[0].strip().strip('`').strip('"')
    content = re.sub(r"^```\w*\s*|\s*```$", "", (parts[1] if len(parts) > 1 else "").strip("\n"))
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


def tool_search_code(arg):
    q, hits = arg.strip(), []
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

SYSTEM = """You are a coding agent in a sandbox 'workspace' folder. You LEARN from failures.
Tools:
- create_file: FIRST line = path, following lines = file content. Do NOT use '|', quotes, or markdown fences.
    Example:
    Action: create_file
    Action Input: hello.py
    print("hello")
- view_file: show file. Action Input: path.
- run_python: run a py file. Action Input: path.
- search_code: search text. Action Input: query.

Format, ONE step at a time:
Thought: <reasoning>
Action: <tool>
Action Input: <input>

If an Observation shows an error, first write a short Reflection on WHY it failed
and HOW to fix it, then take the corrected action. When done AND verified:
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
    return any(k in obs for k in ("Error", "Traceback", "Exception", "no matches", "not defined"))


def run(task, max_steps=12):
    messages = [{"role": "system", "content": SYSTEM},
                {"role": "user", "content": f"Task: {task}"}]
    reflections = []  # episodic memory (Reflexion 핵심)
    for step in range(max_steps):
        out = call_ollama(messages)
        print(f"\n--- Step {step+1} ---\n{out.strip()}")
        messages.append({"role": "assistant", "content": out})
        if "Final Answer:" in out:
            return out.split("Final Answer:")[-1].strip()
        m = re.search(r"Action:\s*(\w+).*?Action Input:\s*(.+)", out, re.DOTALL)
        if not m:
            messages.append({"role": "user", "content": "Observation: invalid format."})
            continue
        tool, arg = m.group(1).strip(), m.group(2).strip()
        try:
            obs = TOOLS.get(tool, lambda x: f"unknown tool: {tool}")(arg)
        except Exception as e:
            obs = f"Error: {e}"
        print(f"[Observation] {obs[:300]}")
        # Reflexion: 실패 시 반성 유도 (언어적 강화)
        if is_failure(obs):
            reflections.append(f"step {step+1}: {tool} -> {obs[:80]}")
            note = ("\n\n[Reflexion] The last action FAILED. Write a Reflection: why did it fail, "
                    "and what will you do differently? Then take the corrected action.")
            print("  >> 실패 감지 → 자기반성 유도")
        else:
            note = ""
        messages.append({"role": "user", "content": f"Observation: {obs}{note}"})
    return f"(max steps) reflections={reflections}"


if __name__ == "__main__":
    task = sys.argv[1] if len(sys.argv) > 1 else \
        "Create divide.py that prints 10/0, run it, observe the error, then fix it to print 10/2."
    print("TASK:", task)
    print("\n=== RESULT ===\n" + run(task))
