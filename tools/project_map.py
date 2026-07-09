"""
프로젝트 요약 생성 (md 압축 메모리) — MemGPT식 외부 메모리.
큰 프로젝트를 1페이지로 압축해 32K context 안에서 전체 구조를 파악하게 한다.
실행: python tools/project_map.py [프로젝트경로]  -> PROJECT_MAP.md 생성
"""
import ast, os, sys
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows cp949 크래시 방지
except Exception:
    pass

SKIP = ('.git', '__pycache__', 'workspace', 'node_modules', '.venv', 'out', 'model_ft')


def summarize(root):
    lines = ["# PROJECT MAP (압축 요약 — 전체 파악용)\n"]
    for dp, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP]
        for fn in sorted(files):
            if not fn.endswith(".py"):
                continue
            path = os.path.join(dp, fn)
            rel = os.path.relpath(path, root).replace("\\", "/")
            try:
                src = open(path, encoding="utf-8").read()
                tree = ast.parse(src)
            except Exception:
                continue
            classes = [n.name for n in tree.body if isinstance(n, ast.ClassDef)]
            funcs = [n.name for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
            doc = (ast.get_docstring(tree) or "").split("\n")[0][:70]
            lines.append(f"## {rel}  ({len(src.splitlines())} lines)")
            if doc:
                lines.append(f"- {doc}")
            if classes:
                lines.append(f"- classes: {', '.join(classes)}")
            if funcs:
                lines.append(f"- functions: {', '.join(funcs[:15])}")
            lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    root = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
    text = summarize(root)
    out = os.path.join(root, "PROJECT_MAP.md")
    open(out, "w", encoding="utf-8").write(text)
    print(text[:600])
    print(f"\n... saved {out} ({len(text)} chars, vs 원본 전체는 수만 chars)")
