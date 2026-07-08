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
