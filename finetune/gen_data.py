"""
self-instruct 데이터 생성 (파인튜닝 실험용)
내가 준 임의 코딩 태스크 → qwen3-coder가 짠 코드 → jsonl 데이터셋
⚠️ 자기생성 데이터라 성능↑ 기대는 낮음 (파이프라인 실증 목적)
"""
import json, os, urllib.request

OLLAMA = "http://localhost:11434/api/generate"
MODEL = "qwen3-coder-cline:30b"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ft_data.jsonl")

TASKS = [
    "Write a Python function is_palindrome(s) that checks if a string is a palindrome, ignoring case and spaces.",
    "Write a Python function flatten(nested) that flattens an arbitrarily nested list into a flat list.",
    "Write a Python function word_frequency(text) returning a dict of word counts, case-insensitive.",
    "Write a Python function merge_sorted(a, b) that merges two sorted lists into one sorted list.",
    "Write a Python function is_balanced(s) that checks if brackets ()[]{} in a string are balanced.",
    "Write a Python function roman_to_int(s) that converts a Roman numeral string to an integer.",
    "Write a Python function chunk(lst, n) that splits a list into chunks of size n.",
    "Write a Python function gcd(a, b) using Euclid's algorithm, and lcm(a, b) using it.",
    "Write a Python class Stack with push, pop, peek, is_empty methods.",
    "Write a Python function run_length_encode(s) that does run-length encoding of a string.",
]


def gen(task):
    body = json.dumps({"model": MODEL, "prompt": task, "stream": False,
                       "options": {"temperature": 0.3}}).encode()
    req = urllib.request.Request(OLLAMA, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)["response"]


if __name__ == "__main__":
    data = []
    for i, t in enumerate(TASKS):
        out = gen(t)
        data.append({"instruction": t, "output": out})
        print(f"[{i+1}/{len(TASKS)}] {t[:50]}...", flush=True)
    with open(OUT, "w", encoding="utf-8") as f:
        for d in data:
            f.write(json.dumps(d, ensure_ascii=False) + "\n")
    print(f"saved {len(data)} examples -> {OUT}")
