"""확장 자체검사 — codeact를 확장과 동일 조건(AGENT_JSON)으로 실행하고,
확장의 파싱 로직을 재현해 FINAL 중복/누락·구조를 자동 검증한다.
(webview '화면'은 못 보지만 '로직'은 검증 → 스크린샷 의존을 줄임)
실행: python tools/selfcheck.py "안녕" "sq.py 만들어 add 함수 넣고 테스트"
"""
import subprocess, sys, os
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AGENT = os.path.join(BASE, "agent", "codeact_agent.py")


def check(task):
    env = dict(os.environ, AGENT_JSON="1", PYTHONIOENCODING="utf-8")
    try:
        r = subprocess.run([sys.executable, AGENT, task], env=env, capture_output=True,
                           text=True, encoding="utf-8", errors="replace", timeout=200)
    except Exception as e:
        print(f"[{task}] ❌ 실행 실패: {e}")
        return False
    out = r.stdout + r.stderr

    # 확장 파싱 재현: \x1e 라인 = 스트리밍 토큰(실시간 표시용, 최종 렌더 아님) → 무시.
    # 일반 라인만 확장 renderLine이 최종 구조화 → FINAL 개수가 화면 답변 개수.
    finals, thoughts, obs, has_error = [], 0, 0, False
    for raw in out.splitlines():
        if raw.startswith("\x1e"):
            continue
        if raw.startswith("FINAL:"):
            finals.append(raw[6:].strip())
        elif raw.startswith("Thought:"):
            thoughts += 1
        elif raw.startswith("[Observation]"):
            obs += 1
        if "Traceback" in raw or "Error:" in raw:
            has_error = True

    ans = finals[-1] if finals else "(FINAL 없음)"
    korean = any("가" <= c <= "힣" for c in ans)  # 한글 포함 여부
    print(f"\n[{task}]")
    print(f"  FINAL 개수={len(finals)}  Thought={thoughts}  Obs={obs}  에러={has_error}")
    print(f"  답변: {ans[:120]}")

    problems = []
    if len(finals) != 1:
        problems.append(f"FINAL이 {len(finals)}개 (1개여야 — 중복/누락)")
    if not korean and ans and "(FINAL" not in ans:
        problems.append("답변에 한글 없음 (영어로 답함)")
    if has_error:
        problems.append("실행 중 에러/Traceback")
    if problems:
        print("  ❌ FAIL: " + " / ".join(problems))
        return False
    print("  ✅ PASS")
    return True


if __name__ == "__main__":
    tasks = sys.argv[1:] or ["안녕"]
    results = [check(t) for t in tasks]
    print(f"\n=== {sum(results)}/{len(results)} PASS ===")
    sys.exit(0 if all(results) else 1)
