"""
ReAct 미니 에이전트 — 로드맵 1단계 (arXiv 2210.03629)
Thought -> Action -> Observation 루프 + Ollama 로컬 모델 + 도구 3개.
실행: python agent/react_agent.py "질문"
"""
import json, sys, re, io, contextlib, urllib.request, urllib.parse
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except:
    pass


OLLAMA = "http://localhost:11434/api/chat"
MODEL = "qwen3-coder-cline:30b"
SEARXNG = "http://localhost:8888/search"


# ---- 도구 3개 (SWE-agent 원칙: 좁고 안전하게) ----
def tool_python(code):
    """계산·간단 로직용 파이썬 실행 (CodeAct 맛보기)"""
    # 모델이 코드를 백틱/```python 으로 감싸는 습관 제거
    code = re.sub(r"^```(?:python)?\s*|\s*```$", "", code.strip()).strip().strip("`").strip()
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            exec(code, {})
        return buf.getvalue().strip() or "(no output)"
    except Exception as e:
        return f"Error: {e}"


def tool_read_file(path):
    try:
        with open(path.strip().strip('"'), encoding="utf-8") as f:
            return f.read()[:2000]
    except Exception as e:
        return f"Error: {e}"


def tool_web_search(query):
    """우리 SearXNG(무제한 로컬 웹서치) 연결"""
    try:
        url = SEARXNG + "?" + urllib.parse.urlencode({"q": query, "format": "json"})
        with urllib.request.urlopen(url, timeout=15) as r:
            data = json.load(r)
        rows = data.get("results", [])[:3]
        return "\n".join(f"- {x.get('title','')}: {x.get('content','')[:150]}" for x in rows) or "no results"
    except Exception as e:
        return f"Error: {e}"


TOOLS = {"python": tool_python, "read_file": tool_read_file, "web_search": tool_web_search}

SYSTEM = """You are a ReAct agent. Solve the question step by step using tools.
Tools:
- python: run python code for calculation. Action Input = the code.
- read_file: read a file. Action Input = the path.
- web_search: search the web. Action Input = the query.

Always answer in EXACTLY this format, ONE step at a time:
Thought: <your reasoning>
Action: <one of: python, read_file, web_search>
Action Input: <input>

Then STOP and wait for Observation. When you have the answer:
Thought: I now know the final answer
Final Answer: <answer>
"""


def call_ollama(messages):
    body = json.dumps({
        "model": MODEL, "messages": messages, "stream": False,
        "options": {"stop": ["Observation:"], "temperature": 0.3},
    }).encode()
    req = urllib.request.Request(OLLAMA, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)["message"]["content"]


def run(question, max_steps=6):
    messages = [{"role": "system", "content": SYSTEM},
                {"role": "user", "content": f"Question: {question}"}]
    for step in range(max_steps):
        out = call_ollama(messages)
        print(f"\n--- Step {step+1} ---\n{out.strip()}")
        if "Final Answer:" in out:
            return out.split("Final Answer:")[-1].strip()
        m = re.search(r"Action:\s*(\w+).*?Action Input:\s*(.+)", out, re.DOTALL)
        messages.append({"role": "assistant", "content": out})
        if not m:
            messages.append({"role": "user", "content": "Observation: invalid format, follow Thought/Action/Action Input."})
            continue
        tool, arg = m.group(1).strip(), m.group(2).strip()
        obs = TOOLS.get(tool, lambda x: f"unknown tool: {tool}")(arg)
        print(f"[Observation] {obs[:300]}")
        messages.append({"role": "user", "content": f"Observation: {obs}"})
    return "(max steps reached)"


if __name__ == "__main__":
    q = sys.argv[1] if len(sys.argv) > 1 else "Compute 1234 * 5678 using the python tool."
    print("Q:", q)
    print("\n=== FINAL ANSWER ===\n" + run(q))
