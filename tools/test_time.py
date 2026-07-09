"""
test-time compute: 자기완결 태스크를 N번 독립 시도, 성공 마커가 나오면 채택.
로컬 30B가 비결정적이라 가끔 실패하는 태스크의 성공률을 올린다 (대신 느림, N배 호출).
o1/self-consistency의 단순 버전.
실행: python tools/test_time.py "태스크(끝에 print MARKER)" MARKER [tries]
"""
import subprocess, sys, os
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AGENT = os.path.join(BASE, "agent", "codeact_agent.py")


def solve(task, marker, tries=3):
    for i in range(tries):
        try:
            r = subprocess.run([sys.executable, AGENT, task], capture_output=True, text=True,
                               encoding="utf-8", errors="replace", timeout=220)
            ok = marker in (r.stdout + r.stderr)
        except Exception:
            ok = False
        print(f"  시도 {i+1}/{tries}: {'✅ 성공' if ok else '❌ 실패'}", flush=True)
        if ok:
            return i + 1
    return None


if __name__ == "__main__":
    task, marker = sys.argv[1], sys.argv[2]
    tries = int(sys.argv[3]) if len(sys.argv) > 3 else 3
    r = solve(task, marker, tries)
    print(f"=== {'성공 (시도 ' + str(r) + '회 만에)' if r else str(tries) + '회 전부 실패'} ===")
