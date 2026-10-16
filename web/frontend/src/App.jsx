import { useEffect, useRef, useState } from "react";

// POST 요청의 SSE 응답을 읽어 이벤트마다 onEvent 호출
async function streamPost(url, body, onEvent, signal) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (chunk.startsWith("data: ")) onEvent(JSON.parse(chunk.slice(6)));
    }
  }
}

// ```코드``` 부분만 코드 상자로, 나머지는 그대로 글
function Rich({ text }) {
  return text.split(/```(?:\w+)?\n?([\s\S]*?)(?:```|$)/).map((part, i) =>
    i % 2 ? <pre key={i}>{part.trimEnd()}</pre> : part && <span key={i}>{part}</span>
  );
}

export default function App() {
  const [models, setModels] = useState([]);
  const [model, setModel] = useState(localStorage.getItem("model") || "");
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const abortRef = useRef(null);
  const runIdRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    fetch("/api/models")
      .then((r) => (r.ok ? r.json() : r.text().then((t) => Promise.reject(new Error(t)))))
      .then((d) => {
        setModels(d.models);
        if (!d.models.includes(model)) setModel(d.models[0] || "");
      })
      .catch((e) => setErr("모델 목록을 못 불러옴: " + e.message));
  }, []);

  // effect 는 아무것도 return 하면 안 됨 (Promise 등을 돌려주면 React 가 앱 전체를 내림) → 중괄호 필수
  useEffect(() => { localStorage.setItem("model", model); }, [model]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  // 마지막(assistant) 메시지 수정
  const patchLast = (fn) =>
    setMsgs((m) => {
      const copy = m.slice();
      copy[copy.length - 1] = fn({ ...copy[copy.length - 1] });
      return copy;
    });

  async function send() {
    const text = input.trim();
    if (!text || busy || !model) return;
    setInput("");
    setErr("");
    const history = msgs;
    setMsgs([...history, { role: "user", text }, { role: "assistant", text: "", log: "" }]);
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      let inObs = false;
      const hist = history.slice(-6).map((m) => `${m.role === "user" ? "나" : "AI"}: ${m.text.slice(0, 500)}`).join("\n");
      await streamPost("/api/agent", { model, task: text, history: hist }, (ev) => {
        if (ev.t === "run") runIdRef.current = ev.id;
        else if (ev.t === "step") patchLast((m) => ({ ...m, step: ev.n, log: m.log + `\n\n── Step ${ev.n} ──\n` }));
        else if (ev.t === "action") patchLast((m) => ({ ...m, action: ev.d }));
        else if (ev.t === "tok") patchLast((m) => ({ ...m, log: m.log + ev.d }));
        else if (ev.t === "line") {
          // [Observation] 은 여러 줄로 올 수 있음 → 다음 "--- Step" 줄 전까지 이어지는 줄도 로그에 붙임
          if (ev.d.startsWith("[Observation]")) inObs = true;
          else if (ev.d.startsWith("--- Step") || ev.d.startsWith("FINAL:") || ev.d.startsWith("=== RESULT")) inObs = false;
          if (inObs) patchLast((m) => ({ ...m, log: m.log + "\n" + ev.d }));
        }
        else if (ev.t === "files") patchLast((m) => ({ ...m, files: ev.files }));
        else if (ev.t === "end")
          patchLast((m) => ({ ...m, text: ev.final || "작업이 도중에 멈췄습니다. 로그를 확인하고 \"이어서 해줘\"라고 해 보세요." }));
      }, ac.signal);
    } catch (e) {
      if (e.name !== "AbortError") setErr(e.message);
      else patchLast((m) => ({ ...m, text: m.text || "(중단됨)" }));
    } finally {
      setBusy(false);
      abortRef.current = null;
      runIdRef.current = null;
    }
  }

  function stop() {
    if (runIdRef.current) fetch(`/api/stop/${runIdRef.current}`, { method: "POST" });
    abortRef.current?.abort();
  }

  return (
    <div className="app">
      <header>
        <b>Local LLM</b>
        <select value={model} onChange={(e) => setModel(e.target.value)} disabled={busy}>
          {models.map((m) => <option key={m}>{m}</option>)}
        </select>
        <button className="ghost" onClick={() => setMsgs([])} disabled={busy}>새 대화</button>
      </header>

      <main>
        {msgs.length === 0 && (
          <div className="empty">
            에이전트가 파이썬 코드를 실행하며 작업합니다 — 파일 작업, 웹 검색, 날씨 (agent/workspace)
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={"msg " + m.role}>
            {m.log && (
              <details className="log" open={busy && i === msgs.length - 1}>
                <summary>
                  작업 로그{m.step ? ` · Step ${m.step}` : ""}{m.action ? ` · ${m.action}` : ""}
                </summary>
                <pre>{m.log.trim()}</pre>
              </details>
            )}
            <div className="text">
              {m.text ? <Rich text={m.text} /> : busy && i === msgs.length - 1 ? <span className="dots">생성 중…</span> : ""}
            </div>
            {m.files?.length > 0 && (
              <div className="files">
                {m.files.map((f) => (
                  <details key={f.path}>
                    <summary>📄 {f.path}</summary>
                    <pre>{f.content}</pre>
                  </details>
                ))}
              </div>
            )}
          </div>
        ))}
        {err && <div className="err">{err}</div>}
        <div ref={bottomRef} />
      </main>

      <footer>
        <textarea
          value={input}
          placeholder="에이전트에게 시킬 작업 (Enter 전송, Shift+Enter 줄바꿈)"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
        />
        {busy ? <button onClick={stop} className="stop">중단</button> : <button onClick={send} disabled={!input.trim() || !model}>전송</button>}
      </footer>
    </div>
  );
}
