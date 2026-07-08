"""
에이전트 벤치마크 — 정의된 태스크들을 codeact_agent로 실행하고 성공 마커로 채점.
회귀 테스트 + 품질 정량화용.
실행: python agent/benchmark.py
"""
import subprocess, sys, os

BASE = os.path.dirname(os.path.abspath(__file__))
AGENT = os.path.join(BASE, "codeact_agent.py")

# (이름, 태스크, 성공 마커)
TASKS = [
    ("factorial",
     "Create factorial(n). Verify factorial(5)==120 and factorial(0)==1. If both correct, print exactly BENCH_OK.",
     "BENCH_OK"),
    ("palindrome",
     "Create is_palindrome(s). Verify is_palindrome('racecar')==True and is_palindrome('hello')==False. If correct, print exactly BENCH_OK.",
     "BENCH_OK"),
    ("gcd",
     "Create gcd(a,b) using Euclid's algorithm. Verify gcd(48,36)==12 and gcd(17,5)==1. If correct, print exactly BENCH_OK.",
     "BENCH_OK"),
    ("binary_search",
     "Create binary_search(arr, target) returning index or -1. On sorted [1,3,5,7,9]: 7 gives index 3, and 4 gives -1. If correct, print exactly BENCH_OK.",
     "BENCH_OK"),
    ("fizzbuzz",
     "Create fizzbuzz(n): 'Fizz' if divisible by 3, 'Buzz' if by 5, 'FizzBuzz' if by 15, else str(n). Verify fizzbuzz(15)=='FizzBuzz', fizzbuzz(9)=='Fizz', fizzbuzz(10)=='Buzz', fizzbuzz(7)=='7'. If all correct, print exactly BENCH_OK.",
     "BENCH_OK"),
    ("fibonacci",
     "Create fib(n) returning the nth Fibonacci number (fib(0)=0, fib(1)=1). Verify fib(10)==55 and fib(1)==1. If correct, print exactly BENCH_OK.",
     "BENCH_OK"),
    # --- 난이도 상향 (변별력) ---
    ("merge_sort",
     "Create merge_sort(arr) using recursion (divide and merge). Verify merge_sort([5,2,8,1,9,3,7])==[1,2,3,5,7,8,9] and merge_sort([])==[]. If correct, print exactly BENCH_OK.",
     "BENCH_OK"),
    ("lru_cache",
     "Create an LRUCache class with __init__(capacity), get(key)->value or -1, put(key,value). Capacity 2: put(1,1); put(2,2); get(1)==1; put(3,3) evicts key 2; get(2)==-1; get(3)==3. If all correct, print exactly BENCH_OK.",
     "BENCH_OK"),
    # --- 실제 디버깅 (버그 생성→진단→수정) ---
    ("debug_max",
     "Create a file with a buggy function `def find_max(lst): return lst[0]`. Run it to see it fails on [3,7,2,9,1]. Then FIX it to return the real maximum. Verify find_max([3,7,2,9,1])==9 and find_max([5])==5. If correct, print exactly BENCH_OK.",
     "BENCH_OK"),
    # --- 실용 태스크 (파일 I/O, 파싱) ---
    ("csv_parse",
     "Write a data.csv file containing 'name,age' then 'Alice,30' then 'Bob,25' (3 lines). Then write parse_csv(path) that reads it and returns a list of dicts. Verify parse_csv('data.csv')==[{'name':'Alice','age':'30'},{'name':'Bob','age':'25'}]. If correct, print exactly BENCH_OK.",
     "BENCH_OK"),
    ("word_count",
     "Write word_count(text) returning a dict of word->count (case-insensitive, split on whitespace). Verify word_count('the cat the dog THE')=={'the':3,'cat':1,'dog':1}. If correct, print exactly BENCH_OK.",
     "BENCH_OK"),
    # --- HARD: 파서 구현 (진짜 변별력, 로컬 30B 한계 탐색) ---
    ("expr_eval",
     "Write eval_expr(s) that evaluates arithmetic with + - * / and operator precedence and parentheses, WITHOUT using eval()/exec()/import. Verify eval_expr('3 + 4 * 2')==11, eval_expr('(1 + 2) * 3')==9, eval_expr('10 - 2 - 3')==5. If all correct, print exactly BENCH_OK.",
     "BENCH_OK"),
    ("json_parse",
     "Write parse_json(s) that parses JSON WITHOUT import json, handling objects, arrays, strings, ints, booleans, null. Verify parse_json('{\"a\": [1, 2], \"b\": true}')=={'a':[1,2],'b':True} and parse_json('[1, \"x\", null]')==[1,'x',None]. If correct, print exactly BENCH_OK.",
     "BENCH_OK"),
    # --- VERY HARD: 다중 컴포넌트 (인터프리터, 상태 시스템) ---
    ("interpreter",
     "Write run_program(src) for a tiny language: statements separated by ';'. Supports 'var = expr' assignment and 'print(expr)'. expr has integer literals, variables, and + - * with precedence. Return all printed outputs joined by newline. Verify run_program('x = 3; y = 4; print(x * y + 1); print(y - x)')=='13\\n1'. If correct, print exactly BENCH_OK.",
     "BENCH_OK"),
    ("bank",
     "Create account.py with an Account class: balance starts 0, deposit(amt) adds, withdraw(amt) subtracts but raises ValueError if amt>balance. Test in another step: a=Account(); a.deposit(100); a.withdraw(30) -> balance 70; a.withdraw(100) raises ValueError. If all correct, print exactly BENCH_OK.",
     "BENCH_OK"),
    # --- 멀티파일 조율 (import 관계) ---
    ("multifile",
     "Create THREE files: mathutils.py with add(a,b) and mul(a,b); calc.py that imports mathutils and has compute() returning add(mul(2,3), 4); main.py that imports calc and prints compute(). Use run_py('main.py') to run it and verify it prints 10. If correct, print exactly BENCH_OK.",
     "BENCH_OK"),
    # --- 사이클3: 플러그인 시스템 + 표준 라이브러리 ---
    ("plugin",
     "Create a plugin system: registry.py with PLUGINS={} and register(name,fn) and run_all() returning {name: fn() for each}. greet.py imports registry and registers 'greet' returning 'hi'. main.py imports registry and greet, then prints run_all(). Use run_py('main.py') and verify output contains 'hi'. Print exactly BENCH_OK if correct.",
     "BENCH_OK"),
    ("stdlib_json",
     "Write a program using Python's json module: data={'v':1,'items':[1,2,3]}; save to out.json with json.dump; read back with json.load into loaded; assert loaded==data. If equal, print exactly BENCH_OK.",
     "BENCH_OK"),
    # --- 사이클4: 긴 멀티스텝 프로젝트 (스텝/컨텍스트 한계 탐색) ---
    ("todo_app",
     "Build a TODO app across files: todo.py (Todo class: id, text, done=False); store.py (Store class: add(text) returns new id starting at 1, list() returns all todos, complete(id) sets done=True, delete(id) removes); main.py that adds 3 todos ('a','b','c'), completes id 2, deletes id 1, then prints the remaining todos. Use run_py('main.py'). Verify 2 todos remain (b done, c not). Print exactly BENCH_OK if correct.",
     "BENCH_OK"),
]


def run_task(task):
    r = subprocess.run([sys.executable, AGENT, task], capture_output=True, text=True, timeout=300)
    return r.stdout + r.stderr


def main():
    passed = 0
    results = []
    for name, task, marker in TASKS:
        try:
            out = run_task(task)
            ok = marker in out
        except Exception as e:
            ok, out = False, str(e)
        results.append((name, ok))
        print(f"[{'PASS' if ok else 'FAIL'}] {name}", flush=True)
        passed += ok
    pct = 100 * passed // len(TASKS)
    print(f"\n=== {passed}/{len(TASKS)} passed ({pct}%) ===")
    return results


if __name__ == "__main__":
    main()
