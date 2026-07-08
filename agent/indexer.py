"""
코드베이스 인덱싱 — 로드맵 5단계 (Codebase Memory / RAG)
Python ast로 함수/클래스 추출 -> nomic-embed-text 임베딩 -> 의미 기반 검색.
사용:
  python agent/indexer.py index [dir]     # 인덱싱
  python agent/indexer.py search "쿼리"    # 검색
"""
import ast, os, json, math, sys, urllib.request

OLLAMA_EMB = "http://localhost:11434/api/embeddings"
BASE = os.path.dirname(os.path.abspath(__file__))
INDEX_FILE = os.path.join(BASE, "code_index.json")


def embed(text):
    body = json.dumps({"model": "nomic-embed-text", "prompt": text[:2000]}).encode()
    req = urllib.request.Request(OLLAMA_EMB, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)["embedding"]


def cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb + 1e-9)


def index_dir(root):
    items = []
    for dp, _, files in os.walk(root):
        if ".git" in dp or "workspace" in dp or "__pycache__" in dp:
            continue
        for fn in files:
            if not fn.endswith(".py"):
                continue
            path = os.path.join(dp, fn)
            try:
                src = open(path, encoding="utf-8").read()
                tree = ast.parse(src)
            except Exception:
                continue
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    seg = ast.get_source_segment(src, node) or ""
                    doc = ast.get_docstring(node) or ""
                    text = f"{node.name}\n{doc}\n{seg[:500]}"
                    items.append({"name": node.name, "file": os.path.relpath(path, root),
                                  "line": node.lineno, "emb": embed(text)})
                    print(f"  indexed {node.name}  ({os.path.relpath(path, root)}:{node.lineno})")
    json.dump(items, open(INDEX_FILE, "w", encoding="utf-8"), ensure_ascii=False)
    return len(items)


def search(query, k=3):
    items = json.load(open(INDEX_FILE, encoding="utf-8"))
    q = embed(query)
    scored = sorted(items, key=lambda x: cosine(q, x["emb"]), reverse=True)
    return [(x["name"], x["file"], x["line"], round(cosine(q, x["emb"]), 3)) for x in scored[:k]]


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "index":
        root = sys.argv[2] if len(sys.argv) > 2 else BASE
        print(f"=== indexing {root} ===")
        print(f"indexed {index_dir(root)} functions/classes")
    elif len(sys.argv) > 1 and sys.argv[1] == "search":
        for name, file, line, sim in search(" ".join(sys.argv[2:])):
            print(f"  {sim}  {name}  ({file}:{line})")
    else:
        print("usage: indexer.py index [dir] | search <query>")
