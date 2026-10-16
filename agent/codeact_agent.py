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

# 기본 = karma(4060) LLM 전담 → 5080은 Isaac Sim 상시 전담(경합 회피).
# 5080의 30B를 쓰려면: OLLAMA_HOST=http://localhost:11434 AGENT_MODEL=qwen3-coder-cline:30b
OLLAMA_HOST = (os.environ.get("OLLAMA_HOST") or "http://100.126.163.103:11434").rstrip("/")  # 빈 값 방어
OLLAMA = OLLAMA_HOST + "/api/chat"
MODEL = os.environ.get("AGENT_MODEL") or "hf.co/unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q2_K_XL"  # 기본 Qwen3.6-35B Q2(속도우선 ~37tok/s). 정확도용 Q3는 AGENT_MODEL=...UD-Q3_K_M
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


def _fetch_url(url, max_chars=3000):
    """namespace에 주입 — 웹 페이지 본문 텍스트 (web_search 스니펫만으로 부족할 때)"""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            html = r.read().decode(r.headers.get_content_charset() or "utf-8", "replace")
        html = re.sub(r"(?is)<(script|style|noscript).*?</\1>", " ", html)
        text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html)).strip()
        return text[:max_chars]
    except Exception as e:
        return f"fetch error: {e}"


_WMO = {0: "맑음", 1: "대체로 맑음", 2: "구름 조금", 3: "흐림", 45: "안개", 48: "안개", 51: "약한 이슬비", 53: "이슬비", 55: "강한 이슬비",
        61: "약한 비", 63: "비", 65: "강한 비", 71: "약한 눈", 73: "눈", 75: "강한 눈", 80: "소나기", 81: "소나기", 82: "강한 소나기",
        95: "뇌우", 96: "우박 동반 뇌우", 99: "우박 동반 뇌우"}


def _get_weather(city):
    """namespace에 주입 — 실시간 날씨 + 3일 예보 (Open-Meteo, 키 불필요). city 는 영어 이름 (예: 'Seoul', 'Busan')"""
    import urllib.parse
    try:
        q = urllib.parse.urlencode({"name": city, "count": 1, "language": "ko"})
        with urllib.request.urlopen("https://geocoding-api.open-meteo.com/v1/search?" + q, timeout=15) as r:
            res = json.load(r).get("results")
        if not res:
            return f"weather error: '{city}' 위치를 못 찾음 — 영어 도시 이름으로 다시 (예: 'Seoul')"
        loc = res[0]
        q = urllib.parse.urlencode({"latitude": loc["latitude"], "longitude": loc["longitude"], "timezone": "auto", "forecast_days": 3,
                                    "current": "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
                                    "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"})
        with urllib.request.urlopen("https://api.open-meteo.com/v1/forecast?" + q, timeout=15) as r:
            w = json.load(r)
        c, d = w["current"], w["daily"]
        return {"place": f"{loc['name']} ({loc.get('country', '')})", "time": c["time"],
                "now": f"{_WMO.get(c['weather_code'], c['weather_code'])}, {c['temperature_2m']}°C (체감 {c['apparent_temperature']}°C), "
                       f"습도 {c['relative_humidity_2m']}%, 강수 {c['precipitation']} mm, 바람 {c['wind_speed_10m']} km/h",
                "daily": [f"{d['time'][i]}: {_WMO.get(d['weather_code'][i], d['weather_code'][i])}, {d['temperature_2m_min'][i]}~{d['temperature_2m_max'][i]}°C, "
                          f"강수확률 {d['precipitation_probability_max'][i]}%" for i in range(len(d["time"]))]}
    except Exception as e:
        return f"weather error: {e}"


def _image_search(query, k=3):
    """namespace에 주입 — 이미지 검색(SearXNG) 후 workspace/images/ 에 내려받음. 내려받은 그림은 웹 화면에 자동으로 보인다"""
    import urllib.parse
    try:
        url = SEARXNG + "?" + urllib.parse.urlencode({"q": query, "format": "json", "categories": "images"})
        with urllib.request.urlopen(url, timeout=20) as r:
            results = json.load(r).get("results", [])
    except Exception as e:
        return f"image_search error: {e}"
    os.makedirs("images", exist_ok=True)
    stem = re.sub(r"[^\w-]", "_", query)[:30] or "image"
    got = []
    for x in results:
        if len(got) >= k:
            break
        src = x.get("img_src") or ""
        if not src.startswith("http") or src.lower().split("?")[0].endswith(".svg"):
            continue
        try:
            req = urllib.request.Request(src, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=15) as r:
                ctype = r.headers.get_content_type()
                data = r.read(15 * 1024 * 1024)
            if not ctype.startswith("image/") or ctype == "image/svg+xml" or len(data) < 5000:
                continue  # 아이콘·깨진 링크 건너뜀
            ext = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}.get(ctype, ".jpg")
            path = f"images/{stem}_{len(got) + 1}{ext}"
            with open(path, "wb") as fh:
                fh.write(data)
            got.append({"path": path, "title": x.get("title"), "source": x.get("url")})
        except Exception:
            continue
    return got or "image_search: 내려받을 수 있는 이미지를 못 찾음 — 검색어를 바꿔 보라"


VISION_MODEL = os.environ.get("VISION_MODEL") or "qwen2.5vl:7b"


def _see_image(path, question="이 이미지에 무엇이 있는지 자세히 설명해줘. 글자가 있으면 그대로 옮겨 적어줘."):
    """namespace에 주입 — 비전 모델(qwen2.5vl)로 이미지 읽기. path 는 workspace 기준 경로"""
    import base64
    try:
        with open(path, "rb") as fh:
            img = base64.b64encode(fh.read()).decode()
        body = json.dumps({"model": VISION_MODEL, "stream": False, "keep_alive": "10m",
                           "messages": [{"role": "user", "content": question, "images": [img]}]}).encode()
        req = urllib.request.Request(OLLAMA, data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.load(r)["message"]["content"].strip()
    except Exception as e:
        return f"see_image error: {e}"


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


def _grep_code(pattern, path=None):
    """워크스페이스에서 정규식 패턴 검색 (Claude Code식 grep — 벡터검색보다 정확). 반환: 파일:줄:내용."""
    import re
    root = path or WORKSPACE
    try:
        rx = re.compile(pattern)
    except Exception as e:
        return f"regex error: {e}"
    hits = []
    for dp, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in (".git", "__pycache__", "venv", ".venv", "node_modules", "workspace")]
        for fn in files:
            if not fn.endswith((".py", ".js", ".ts", ".md", ".txt", ".json", ".yaml", ".yml", ".toml")):
                continue
            fp = os.path.join(dp, fn)
            try:
                for i, line in enumerate(open(fp, encoding="utf-8", errors="replace"), 1):
                    if rx.search(line):
                        hits.append(f"{os.path.relpath(fp, root)}:{i}: {line.strip()[:120]}")
                        if len(hits) >= 25:
                            return "\n".join(hits)
            except Exception:
                continue
    return "\n".join(hits) if hits else "(매치 없음)"


def _detect_action(code):
    """실행할 코드에서 현재 무슨 작업인지 감지 (확장 진행표시용)."""
    import re
    if "grep_code" in code or "search_codebase" in code:
        return "🔍 코드 검색"
    if re.search(r"open\([^)]*,\s*['\"][wa]", code):
        return "✏️ 파일 작성"
    if "run_py" in code:
        return "▶ 실행"
    if "image_search" in code:
        return "🔎 이미지 검색"
    if "see_image" in code:
        return "🖼 이미지 읽기"
    if "get_weather" in code:
        return "🌤 날씨 조회"
    if "web_search" in code or "fetch_url" in code:
        return "🌐 웹 검색"
    if ".read()" in code or "open(" in code:
        return "📄 파일 읽기"
    return "🔧 처리 중"


SYSTEM = """You are a coding agent. You act ONLY by writing Python code.
Each turn respond in this format:
Thought: <번호 매긴 단계로 추론하라 — 예: "1) grep_code로 X 확인 2) Y 수정 3) 재읽기로 검증". 단계를 명시하면 실수가 줄고 정확도가 오른다.>
```python
<code to run>
```
Rules:
- For a complex/multi-part task, FIRST write a short numbered PLAN (2-4 steps) in your Thought, then execute ONE step per turn. Don't cram multiple file operations into one block.
- The code runs in a PERSISTENT python session, current directory = workspace.
- Create or edit files with open(path, 'w'); read with open(path).read().
- To edit part of a file: read it, modify the string, write it back.
- When parsing text/CSV lines, .strip() each line to remove trailing whitespace/newlines (files may have \\r\\n on Windows).
- Verify by running/importing your code and print(...) the result.
- After writing a .py file, ALWAYS verify it parses: `import ast; ast.parse(open(path,encoding='utf-8').read())`. If SyntaxError, read the file and fix it BEFORE claiming success.
- Keep each code block small and focused (one step). Write a whole file in ONE block (don't split a file across blocks — that causes truncation/syntax errors).
- To ADD to an existing file: in ONE code block, read the whole file, build the new full content string, and write it back — don't stop after just reading.
- 기존 코드베이스의 함수·클래스·라이브러리를 참조·수정할 때는 추측 금지. 먼저 grep_code("패턴")로 실제 코드를 검색해 확인한 뒤 답할 것 — 라이브러리·시그니처·동작을 지어내지 말 것(환각 방지). 예: 무슨 라이브러리 쓰는지 궁금하면 grep_code("import ").
- Before you say FINAL, you MUST re-read the target file(s) and print them to confirm your change is actually present. Never claim success without seeing the change in the file.
- 코드를 작성·수정하면 가능한 경우 동작을 확인하는 간단한 테스트(assert 또는 print로 예상값 비교)를 함께 실행해 통과를 본 뒤 FINAL할 것 — "됐다"고 말하기 전에 테스트로 증명하라 (거짓 성공 방지). 예: def add를 만들었으면 `assert add(2,3)==5; print("OK")`를 실행.
- 작업이 크거나 오래 걸릴 것 같으면(여러 파일·많은 단계) 한 번에 다 하려 하지 말 것. 가장 중요한/요청의 핵심 부분만 처리한 뒤, FINAL로 "여기까지 했습니다. 이어서 <다음에 할 일>이 필요하면 말씀해 주세요"라고 답할 것. 긴 한 번보다 짧게 끊어 여러 번이 낫다. 특히 5~6단계쯤 지났는데 아직 안 끝났으면 지금까지 한 것을 FINAL로 정리하고 멈출 것.
- 이전 단계에서 이미 확인·시도한 것을 반복하지 말 것 — 매 단계는 반드시 새로운 진전이어야 한다. 같은 계획을 다시 쓰지 말 것.
- "요약·설명·파악" 같은 요청은 관련 파일 1~3개만 빠르게 보고 곧바로 FINAL로 답하라. 모든 파일을 다 읽으려 하지 말 것. 정보가 충분하면 헤매지 말고 즉시 FINAL.
Helpers already available (call directly, no import needed):
- web_search(query) -> list of {title, url, content}   # local SearXNG. 스니펫이 부족하면 fetch_url 로 본문을 읽어라
- fetch_url(url) -> 웹 페이지 본문 텍스트 (앞 3000자)
- image_search(query, k=3) -> 이미지를 찾아 workspace/images/ 에 내려받고 [{path, title, source}] 를 돌려줌. 내려받은 그림은 사용자 화면에 자동으로 보인다. "~ 이미지/사진 찾아줘" 는 사이트 링크를 주지 말고 이것을 써라. 답에는 각 그림의 출처 [제목](source) 를 적어라
- see_image(path, question) -> 이미지 내용을 글로 (비전 모델). 사용자가 이미지를 첨부하면 이것으로 먼저 읽고 답하라. 질문을 구체적으로 넘겨라
- 그림·그래프를 만들어 달라면 matplotlib 등으로 workspace 에 .png 로 저장하라 (plt.savefig('chart.png')) — 저장한 이미지는 사용자 화면에 자동으로 보인다. plt.show() 금지
- 웹에서 찾은 자료·출처를 답에 적을 때는 반드시 각 항목에 web_search 결과의 실제 url 을 함께 써라. 형식: [제목](https://...) — 링크 없는 자료 목록 금지, url 을 지어내지 말 것
- get_weather(city) -> 실시간 날씨 + 3일 예보. city 는 반드시 영어 이름 (서울→'Seoul', 부산→'Busan'). 날씨 질문엔 web_search 말고 이것을 써라
- save_skill(name, code_string) -> save reusable code for later
- use_skill(name) -> retrieve a previously saved skill's code (reuse instead of rewriting)
- run_py(path) -> run a .py file in a subprocess and return its output. USE THIS to run/test files (esp. multi-file programs) instead of import.
- grep_code(pattern) -> regex로 워크스페이스 전체 검색 (파일:줄:내용). 코드·함수·라이브러리 사용처를 찾는 최우선 도구. 예: grep_code("def eval_expr"), grep_code("import ").
- search_codebase(query) -> 의미 기반 검색(보조). grep_code로 안 나올 때만.
When the task is DONE and verified — OR when the user is just chatting/greeting/asking a question with NO coding task — respond with NO code block:
Thought: done
FINAL: <Write the actual, complete answer to the user in THEIR language (Korean if they wrote Korean). For a coding task: clearly summarize what you did and the result. For chat/greeting/questions: answer naturally, warmly and helpfully — NOT a terse one-liner like "Ready for tasks".>

Example (the common real-use pattern — modifying existing code):
Thought: Plan: 1) read the file, 2) modify the content, 3) write it back, 4) re-read to confirm. First, read it.
```python
print(open('target.py', encoding='utf-8').read())
```
(next turn: write the FULL modified content back in one block, then re-read and print to confirm the change is there.)
"""


CALL_TIMEOUT = int(os.environ.get("AGENT_TIMEOUT", "180"))  # reasoning 모델(R1)은 느려서 늘릴 수 있게
JSON_MODE = os.environ.get("AGENT_JSON") == "1"  # 확장이 켜면 토큰을 \x1e JSON 라인으로 실시간 스트리밍


def emit(obj):
    if JSON_MODE:
        print("\x1e" + json.dumps(obj, ensure_ascii=False), flush=True)


def call_ollama(messages):
    # JSON_MODE면 stream=True로 토큰을 실시간 받아 확장에 한 글자씩 흘려보낸다(한 번에 안 나오게).
    # keep_alive: 모델을 30분 메모리에 상주 → 매 요청마다 17GB 재로드(60초) 방지
    body = json.dumps({"model": MODEL, "messages": messages, "stream": JSON_MODE, "keep_alive": "30m",
                       "options": {"temperature": 0.2, "num_ctx": int(os.environ.get("AGENT_NUM_CTX", "8192"))}}).encode()
    req = urllib.request.Request(OLLAMA, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=CALL_TIMEOUT) as r:
        if not JSON_MODE:
            return json.load(r)["message"]["content"]
        full = ""
        for raw in r:
            raw = raw.strip()
            if not raw:
                continue
            o = json.loads(raw)
            tok = o.get("message", {}).get("content", "")
            if tok:
                full += tok
                emit({"t": "tok", "d": tok})
            if o.get("done"):
                break
        emit({"t": "gen_done"})
        return full


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
                # REPL식: 마지막 줄이 표현식(예: grep_code(...))이면 자동 출력 → print 빼먹어도 결과가 보임
                try:
                    import ast as _ast
                    _tree = _ast.parse(code)
                    if _tree.body and isinstance(_tree.body[-1], _ast.Expr):
                        exec(compile(_ast.Module(_tree.body[:-1], []), "<agent>", "exec"), ns)
                        _v = eval(compile(_ast.Expression(_tree.body[-1].value), "<agent>", "eval"), ns)
                        if _v is not None:
                            print(_v if isinstance(_v, str) else repr(_v))
                    else:
                        exec(code, ns)
                except SyntaxError:
                    exec(code, ns)
            o = buf.getvalue().strip()
            result["out"] = o[:1500] if o else "(no output)"
        except Exception:
            result["out"] = (buf.getvalue() + "\n" + traceback.format_exc()).strip()[-1200:]

    t = threading.Thread(target=_target, daemon=True)
    t.start()
    t.join(timeout)
    return result["out"]


def is_print_only(code):
    """코드가 문자열 상수 print()뿐인가 — 모델이 코드로 '말하기'만 하는 경우 (인사·잡담에서 FINAL 대신 print 반복)."""
    import ast as _ast
    try:
        tree = _ast.parse(code)
    except SyntaxError:
        return False
    return bool(tree.body) and all(
        isinstance(s, _ast.Expr) and isinstance(s.value, _ast.Call)
        and getattr(s.value.func, "id", "") == "print"
        and all(isinstance(a, _ast.Constant) and isinstance(a.value, str) for a in s.value.args)
        for s in tree.body)


def is_failure(obs):
    return any(k in obs for k in ("Error", "Traceback", "Exception", "Assertion", "not found", "BLOCKED"))


def finalize(messages, fallback):
    # 빈손 종료 금지: 단계상한·반복·연속실패로 멈춰도 지금까지 맥락으로 사용자에게 줄 답을 반드시 만든다.
    # (확장은 'FINAL:' 라인만 답으로 잡으므로, 여기서 FINAL을 명시적으로 내보내야 "이어서 해줘" fallback이 안 뜬다)
    # 기존 루프 메시지에 그대로 이어붙이면 모델이 '계획→실행' 관성에 갇혀 또 계획을 뱉는다(Q2 degeneration).
    # → 원 질문 + 관찰 내용만 추출해 '도구 없는 새 대화'로 답을 요청하면 관성이 끊긴다.
    task, obs = "", []
    for m in messages:
        c = m.get("content", "")
        if m["role"] == "user" and "Task:" in c and not task:
            task = c.split("Task:")[-1][:300]
        elif m["role"] == "user" and c.startswith("Observation"):
            obs.append(re.sub(r"^Observation:?\s*", "", c)[:400])
    ctx = "\n---\n".join(obs[-8:])[:2500] or "(관찰된 내용 없음)"
    prompt = (f"사용자 요청: {task.strip()}\n\n[지금까지 도구로 알아낸 내용]\n{ctx}\n\n"
              "위 내용만 근거로 사용자 요청에 답하라. 코드·Thought·계획·'먼저 ~하겠습니다' 같은 말은 쓰지 말고, "
              "사용자에게 그대로 보여줄 완성된 설명 문장만 한국어로 써라. 다 못 했으면 어디까지 됐고 뭐가 남았는지 밝혀라.")
    try:
        out = call_ollama([{"role": "system", "content": "너는 조사 결과를 사용자에게 설명하는 조수다. 지금은 도구가 없고 설명만 한다."},
                           {"role": "user", "content": prompt}])
        ans = out.split("FINAL:")[-1].strip() if "FINAL:" in out else out.strip()
    except Exception:
        ans = ""
    ans = re.sub(r"```.*?```", "", ans, flags=re.S)          # 코드블럭 제거
    ans = re.sub(r"(?is)^\s*thought:\s*", "", ans)            # 앞머리 Thought 라벨 제거
    ans = (ans or fallback).replace("\n", " ").strip()
    print("FINAL: " + ans)  # 확장이 결과로 잡도록 (JSON/일반 모드 공통)
    return ans


def run(task, max_steps=int(os.environ.get("AGENT_MAX_STEPS", "60"))):  # 단계 상한(무한루프 방지). 연속실패 6회면 별도 중단
    os.chdir(WORKSPACE)  # 파일 작업을 workspace로 격리
    if WORKSPACE not in sys.path:
        sys.path.insert(0, WORKSPACE)  # workspace 파일끼리 import 가능하게 (멀티파일 조율)
    ns = {"__name__": "__agent__", "web_search": _web_search, "fetch_url": _fetch_url, "get_weather": _get_weather, "see_image": _see_image, "image_search": _image_search,
          "save_skill": _save_skill, "use_skill": _use_skill, "run_py": _run_py,
          "search_codebase": _search_codebase, "grep_code": _grep_code}
    _sk = _load_skills()
    _hint = ("\nSaved skills available via use_skill(name): " + ", ".join(_sk)) if _sk else ""
    # md 압축 메모리: PROJECT_MAP.md 있으면 프로젝트 구조를 자동 주입 (32K 안에서 전체 파악)
    _pmap = ""
    _pm_path = os.path.join(WORKSPACE, "PROJECT_MAP.md")
    if os.path.exists(_pm_path):
        _pmap = "\n\n[Project structure — PROJECT_MAP.md]\n" + open(_pm_path, encoding="utf-8").read()[:4000]
    # 대화 이어가기: 확장이 AGENT_HISTORY로 이전 대화 맥락을 넘겨주면 앞에 붙인다
    _hist = os.environ.get("AGENT_HISTORY", "").strip()
    _hist_block = f"[이전 대화 맥락 — 참고만]\n{_hist[:3000]}\n\n" if _hist else ""
    # 파일 첨부: 확장이 AGENT_ATTACH로 첨부 파일 내용을 넘겨주면 참고 자료로 포함
    _att = os.environ.get("AGENT_ATTACH", "").strip()
    _att_block = f"[첨부 파일 — 참고 자료]\n{_att[:8000]}\n\n" if _att else ""
    messages = [{"role": "system", "content": SYSTEM},
                {"role": "user", "content": f"{_hist_block}{_att_block}Task: {task}{_hint}{_pmap}"}]
    recent = []
    fail_streak = dup_streak = 0
    for step in range(max_steps):
        emit({"t": "step", "n": step + 1})  # 현재 단계 알림 (확장 진행표시용)
        # context 압축 (mini-swe-agent 교훈): 오래된 observation을 잘라 context bloat 방지
        if len(messages) > 12:
            for msg in messages[2:-6]:
                if msg["role"] == "user" and len(msg["content"]) > 180:
                    msg["content"] = msg["content"][:150] + " ...(truncated to save context)"
        out = call_ollama(messages)
        print(f"\n--- Step {step+1} ---\n{out.strip()[:500]}")
        messages.append({"role": "assistant", "content": out})
        code = extract_code(out)
        early_final = "FINAL:" in out and code is not None
        if "FINAL:" in out and not early_final:
            # Self-Refine 제거: 로컬 30B에서 self-review가 완료를 방해(무한 개선 유도)하고
            # 엣지케이스 개선 효과도 없어 순해로움 → 바로 종료 (실패 기반 개선)
            return out.split("FINAL:")[-1].strip()
        # 코드와 FINAL 을 한 응답에 같이 쓰면 = 실행 결과를 보기 전에 답을 지어냄 ("[온도]°C" 같은 빈칸 답)
        # → FINAL 은 버리고 코드를 먼저 실행한 뒤, 결과를 보고 다시 FINAL 하게 한다
        if not code:
            messages.append({"role": "user", "content": "Observation: no code block found. Write a ```python block or FINAL:."})
            continue
        if is_print_only(code):
            # 고정 문장만 print = 사용자에게 하는 말 → 그 출력을 답으로 바로 끝냄 (같은 인사를 단계마다 반복하던 루프 방지)
            ans = execute(code, ns).strip()
            print("FINAL: " + ans.replace("\n", " "))
            return ans
        emit({"t": "action", "d": _detect_action(code)})  # 현재 작업 알림 (진행표시)
        # no-progress 감지 (mini-swe-agent 교훈): 같은 코드를 반복하면 진전 없음 → 중단
        dup = code.strip() in recent[-3:]
        recent.append(code.strip())
        if dup:
            dup_streak += 1
            if dup_streak >= 2:  # 같은 작업 2회 반복 = 무한루프 → 지금까지 결과로 마무리(빈손 종료 금지)
                return finalize(messages, "같은 작업을 반복해 진전이 없어 멈췄습니다. 지금까지 한 내용은 파일에 반영됐을 수 있어요.")
        else:
            dup_streak = 0
        obs = execute(code, ns)
        print(f"[Observation] {obs[:250]}")
        if is_failure(obs):
            fail_streak += 1
            if fail_streak >= 6:  # 무한 반복 방지 (no-progress 조기 종료) → 지금까지 결과로 마무리
                return finalize(messages, "여러 번 연속 실패해 멈췄습니다. 지금까지 시도한 내용을 확인해 더 구체적으로 다시 시켜주세요.")
        else:
            fail_streak = 0
        note = "\n(Note: you repeated the same code. Try a different approach.)" if dup else ""
        if early_final:
            note += ("\n(Note: you wrote FINAL before seeing this result, so it was ignored. "
                     "Now write FINAL using the ACTUAL values above — no placeholders like [온도].)")
        messages.append({"role": "user", "content": f"Observation:\n{obs}{note}"})
    return finalize(messages, "단계 상한에 도달했습니다. 작업이 크면 더 작게 나눠서 시켜주세요.")


if __name__ == "__main__":
    task = sys.argv[1] if len(sys.argv) > 1 else \
        "Create sq.py defining square(n) returning n+n (a bug, should be n*n). Run square(5) to see 10. Fix ONLY the return line to n*n by reading/editing the file. Re-run to verify 25."
    print("TASK:", task)
    print("\n=== RESULT ===\n" + run(task))
