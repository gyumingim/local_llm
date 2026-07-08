"""
Voyager 에이전트 — 로드맵 4단계 (arXiv 2305.16291)
Reflexion(3단계) + 스킬 라이브러리: 성공한 코드를 저장하고 다음에 재사용.
실행: python agent/voyager_agent.py "태스크"
"""
import json, sys, re, os, subprocess, urllib.request
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except:
    pass

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


def _load_skills():
    return json.load(open(SKILLS_FILE, encoding="utf-8")) if os.path.exists(SKILLS_FILE) else {}


def tool_create_file(arg):
    arg = re.sub(r"^\s*Action Input:\s*", "", re.sub(r"^\|\s*\n?", "", arg.strip()), flags=re.M)
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


def tool_run_python(arg):
    try:
        r = subprocess.run([sys.executable, _safe(arg)], capture_output=True, text=True, timeout=30, cwd=WORKSPACE)
        return (r.stdout + r.stderr).strip()[:1500] or "(no output)"
    except Exception as e:
        return f"Error: {e}"


def tool_save_skill(arg):
    """성공한 코드를 스킬로 저장. Action Input: FIRST line=name, REST=code"""
    arg = re.sub(r"^\s*Action Input:\s*", "", arg.strip(), flags=re.M)
    parts = arg.split("\n", 1)
    name = parts[0].strip().strip('`').strip('"')
    code = re.sub(r"^```\w*\s*|\s*```$", "", (parts[1] if len(parts) > 1 else "").strip("\n"))
    skills = _load_skills()
    skills[name] = code
    json.dump(skills, open(SKILLS_FILE, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    return f"saved skill '{name}' ({len(skills)} skills total)"


def tool_use_skill(arg):
    """저장된 스킬 코드를 가져옴. Action Input: skill name"""
    return _load_skills().get(arg.strip(), "skill not found")


TOOLS = {"create_file": tool_create_file, "run_python": tool_run_python,
         "save_skill": tool_save_skill, "use_skill": tool_use_skill}

SYSTEM = """You are a coding agent that BUILDS A SKILL LIBRARY (Voyager style).
When you write reusable code that works, save it as a skill for future tasks.
Tools:
- create_file: FIRST line = path, following lines = content. No '|', no quotes, no fences.
- run_python: run a py file. Action Input: path.
- save_skill: save reusable code. FIRST line = skill name, following lines = code.
- use_skill: retrieve a saved skill's code. Action Input: skill name.

Format, ONE step at a time:
Thought: <reasoning>
Action: <tool>
Action Input: <input>

If an Observation shows an error, reflect on why and fix it. When done AND verified:
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


def run(task, max_steps=12):
    skills = _load_skills()
    skill_hint = ("Available saved skills: " + ", ".join(skills.keys())) if skills else "No saved skills yet."
    messages = [{"role": "system", "content": SYSTEM},
                {"role": "user", "content": f"{skill_hint}\n\nTask: {task}"}]
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
        note = "\n\n[Reflexion] It failed. Reflect why, then fix." if is_failure(obs) else ""
        messages.append({"role": "user", "content": f"Observation: {obs}{note}"})
    return "(max steps reached)"


if __name__ == "__main__":
    task = sys.argv[1] if len(sys.argv) > 1 else \
        "Write a reusable is_prime(n) function, test it on 17, and save it as a skill named 'is_prime'."
    print("TASK:", task)
    print("\n=== RESULT ===\n" + run(task))
