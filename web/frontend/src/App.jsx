import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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

const EXT = { python: "py", py: "py", javascript: "js", js: "js", typescript: "ts", html: "html", css: "css",
  json: "json", bash: "sh", sh: "sh", powershell: "ps1", sql: "sql", java: "java", c: "c", cpp: "cpp" };
const IMG_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;
const fileUrl = (p) => `/api/file?path=${encodeURIComponent(p)}`;
const dlUrl = (p) => `${fileUrl(p)}&download=1`;
const fmtSec = (ms) => (ms < 60000 ? `${(ms / 1000).toFixed(1)}초` : `${Math.floor(ms / 60000)}분 ${Math.round((ms % 60000) / 1000)}초`);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// 브라우저 저장소 — 대화 목록 기억용 (막혀 있어도 화면은 정상 동작)
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 못 해도 무시 */ } },
};

const readAsDataUrl = (file) =>
  new Promise((ok, bad) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = bad;
    r.readAsDataURL(file);
  });

// ── 작은 아이콘 (SVG) ──────────────────────────────────────
const Icon = {
  plus: <svg viewBox="0 0 20 20" width="18" height="18"><path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>,
  side: <svg viewBox="0 0 20 20" width="18" height="18"><rect x="3" y="4" width="14" height="12" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M8 4v12" stroke="currentColor" strokeWidth="1.5" /></svg>,
  up: <svg viewBox="0 0 20 20" width="18" height="18"><path d="M10 15V5M5.5 9.5 10 5l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  stop: <svg viewBox="0 0 20 20" width="14" height="14"><rect x="5" y="5" width="10" height="10" rx="1.5" fill="currentColor" /></svg>,
  clip: <svg viewBox="0 0 20 20" width="18" height="18"><path d="M13.5 6.5 7.8 12.2a1.6 1.6 0 0 0 2.3 2.3l6-6a3.2 3.2 0 0 0-4.5-4.5l-6.2 6.2a4.8 4.8 0 0 0 6.8 6.8l5.1-5.1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>,
  copy: <svg viewBox="0 0 20 20" width="15" height="15"><rect x="7" y="7" width="9" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>,
  down: <svg viewBox="0 0 20 20" width="15" height="15"><path d="M10 4v9M6 9.5l4 4 4-4M4.5 16h11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  chev: <svg viewBox="0 0 20 20" width="14" height="14"><path d="M7 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  x: <svg viewBox="0 0 20 20" width="14" height="14"><path d="M5 5l10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>,
  spark: <svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 2.5l1.7 6.1 6.1 1.7-6.1 1.7L12 18.1l-1.7-6.1-6.1-1.7 6.1-1.7z" fill="currentColor" /></svg>,
};

function CopyButton({ text, label }) {
  const [ok, setOk] = useState(false);
  return (
    <button className="icon-btn" title="복사"
      onClick={() => { navigator.clipboard?.writeText(text); setOk(true); setTimeout(() => setOk(false), 1200); }}>
      {Icon.copy}{label && <span>{ok ? "복사됨" : label}</span>}{!label && ok && <span>복사됨</span>}
    </button>
  );
}

// 답 안의 코드 상자 — 언어 · 복사 · 파일로 저장
function CodeBlock({ lang, code }) {
  const save = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([code + "\n"], { type: "text/plain;charset=utf-8" }));
    a.download = `code.${EXT[lang.toLowerCase()] || (lang ? "txt" : "py")}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="code">
      <div className="code-bar">
        <span>{lang || "code"}</span>
        <CopyButton text={code} label="복사" />
        <button className="icon-btn" onClick={save} title="파일로 저장">{Icon.down}<span>저장</span></button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

// 마크다운 답 (목록·굵게·표·링크·코드)
function Markdown({ text }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ node, ...p }) => <a {...p} target="_blank" rel="noreferrer" />,
        // 작업 폴더 안 그림(images/x.jpg 같은 상대 경로)은 아래 그림 목록에 이미 나오므로 본문에서는 뺌
        img: ({ node, src = "", alt }) => (/^https?:/.test(src) ? <img src={src} alt={alt} className="inline-img" /> : null),
        pre: ({ children }) => {
          const c = children?.props || {};
          const lang = /language-([\w+-]+)/.exec(c.className || "")?.[1] || "";
          const code = String(c.children ?? "").replace(/\n$/, "");
          return code.trim() ? <CodeBlock lang={lang} code={code} /> : null; // 빈 코드 블록은 그리지 않음
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

// 걸린 시간 — 진행 중이면 0.1초마다 갱신
function Elapsed({ start, end }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (end) return undefined;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [end]);
  return <span className="elapsed">{fmtSec((end || now) - start)}</span>;
}

// 작업 과정 (Claude 의 도구 사용 블록처럼 접고 펼치기)
function WorkLog({ m, running }) {
  const [open, setOpen] = useState(false);
  if (!m.log) return null;
  return (
    <div className={"worklog" + (open ? " open" : "")}>
      <button className="worklog-head" onClick={() => setOpen(!open)}>
        {running ? <span className="spinner" /> : <span className="dot" />}
        <span className="worklog-title">
          {running ? (m.action ? m.action.replace(/^\S+\s/, "") + " 중…" : "생각하는 중…") : "작업 과정"}
        </span>
        <span className="worklog-meta">{m.step ? `${m.step}단계` : ""}</span>
        <span className="chev">{Icon.chev}</span>
      </button>
      {open && <pre className="worklog-body">{m.log.trim()}</pre>}
    </div>
  );
}

export default function App() {
  const [models, setModels] = useState([]);
  const [model, setModel] = useState(store.get("model", ""));
  const [convs, setConvs] = useState(() => store.get("convs", [])); // [{id, title, msgs, updated}]
  const [cur, setCur] = useState(() => store.get("cur", null));
  const [msgs, setMsgs] = useState(() => store.get("convs", []).find((c) => c.id === store.get("cur", null))?.msgs || []);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState([]); // 보내기 전 첨부 이미지 [{name, dataUrl}]
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [zoom, setZoom] = useState(null);
  const [side, setSide] = useState(() => store.get("side", window.innerWidth > 900));
  const abortRef = useRef(null);
  const runIdRef = useRef(null);
  const bottomRef = useRef(null);
  const fileRef = useRef(null);
  const taRef = useRef(null);

  useEffect(() => {
    fetch("/api/models")
      .then((r) => (r.ok ? r.json() : r.text().then((t) => Promise.reject(new Error(t)))))
      .then((d) => {
        setModels(d.models);
        if (!d.models.includes(model)) setModel(d.models[0] || "");
        if (!d.models.length) setErr("쓸 수 있는 모델이 없습니다 — setup.html 3단계(ollama create)를 확인하세요.");
      })
      .catch((e) => setErr("모델 목록을 못 불러옴: " + e.message));
  }, []);

  // effect 는 아무것도 return 하면 안 됨 → 중괄호 필수
  useEffect(() => { store.set("model", model); }, [model]);
  useEffect(() => { store.set("side", side); }, [side]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs]);
  // 입력창 높이를 내용에 맞춰 늘림
  useEffect(() => {
    const t = taRef.current;
    if (t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 240) + "px"; }
  }, [input]);

  // 대화 저장 (실행 중엔 끝난 뒤 한 번만)
  useEffect(() => {
    if (busy || !cur || !msgs.length) return;
    setConvs((cs) => {
      const title = msgs.find((m) => m.role === "user")?.text.slice(0, 40) || "새 대화";
      const slim = msgs.map((m) => ({ ...m, log: m.log?.slice(-20000) })); // 로그는 끝부분만 저장
      const next = [{ id: cur, title, msgs: slim, updated: Date.now() }, ...cs.filter((c) => c.id !== cur)].slice(0, 50);
      store.set("convs", next);
      return next;
    });
    store.set("cur", cur);
  }, [busy, msgs, cur]);

  const patchLast = (fn) =>
    setMsgs((m) => {
      const copy = m.slice();
      copy[copy.length - 1] = fn({ ...copy[copy.length - 1] });
      return copy;
    });

  function newChat() {
    if (busy) return;
    setCur(null); setMsgs([]); setErr(""); store.set("cur", null);
    if (window.innerWidth <= 900) setSide(false);
    setTimeout(() => taRef.current?.focus(), 0);
  }
  function openChat(c) {
    if (busy) return;
    setCur(c.id); setMsgs(c.msgs); setErr(""); store.set("cur", c.id);
    if (window.innerWidth <= 900) setSide(false);
  }
  function deleteChat(id) {
    setConvs((cs) => { const next = cs.filter((c) => c.id !== id); store.set("convs", next); return next; });
    if (id === cur) newChat();
  }

  async function addFiles(fileList) {
    const imgs = [...fileList].filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    const added = await Promise.all(imgs.map(async (f) => ({ name: f.name || "pasted.png", dataUrl: await readAsDataUrl(f) })));
    setPending((p) => [...p, ...added]);
  }

  async function send() {
    const text = input.trim() || (pending.length ? "첨부한 이미지를 보고 설명해줘" : "");
    if (!text || busy || !model) return;
    setErr("");
    setBusy(true);
    const images = [];
    try {
      for (const p of pending) { // 첨부 이미지를 먼저 workspace/uploads 에 올림
        const r = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: p.name, data: p.dataUrl }),
        });
        if (!r.ok) throw new Error("이미지 올리기 실패: " + (await r.text()));
        images.push((await r.json()).path);
      }
    } catch (e) {
      setErr(e.message);
      setBusy(false);
      return;
    }
    if (!cur) setCur(newId());
    setInput("");
    setPending([]);
    const history = msgs;
    setMsgs([...history, { role: "user", text, images }, { role: "assistant", text: "", log: "", start: Date.now() }]);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      let inObs = false;
      const hist = history.slice(-6).map((m) => `${m.role === "user" ? "나" : "AI"}: ${m.text.slice(0, 500)}`).join("\n");
      await streamPost("/api/agent", { model, task: text, history: hist, images }, (ev) => {
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
        // 사용자가 올린 이미지(uploads/)는 답 아래에 다시 보여 줄 필요 없음
        else if (ev.t === "files") patchLast((m) => ({ ...m, files: ev.files.filter((f) => !f.path.startsWith("uploads/")) }));
        else if (ev.t === "end")
          patchLast((m) => ({ ...m, text: ev.final || "작업이 도중에 멈췄습니다. 작업 과정을 확인하고 \"이어서 해줘\"라고 해 보세요." }));
      }, ac.signal);
    } catch (e) {
      if (e.name !== "AbortError") setErr(e.message);
      else patchLast((m) => ({ ...m, text: m.text || "(중단됨)" }));
    } finally {
      patchLast((m) => (m.role === "assistant" && !m.end ? { ...m, end: Date.now() } : m));
      setBusy(false);
      abortRef.current = null;
      runIdRef.current = null;
    }
  }

  function stop() {
    if (runIdRef.current) fetch(`/api/stop/${runIdRef.current}`, { method: "POST" });
    abortRef.current?.abort();
  }

  const empty = msgs.length === 0;
  const hour = new Date().getHours();
  const greet = hour < 6 ? "늦은 밤이네요" : hour < 12 ? "좋은 아침이에요" : hour < 18 ? "좋은 오후예요" : "좋은 저녁이에요";

  const composer = (
    <div className="composer-wrap">
      <div className="composer">
        {pending.length > 0 && (
          <div className="pending">
            {pending.map((p, k) => (
              <div key={k} className="pend">
                <img src={p.dataUrl} alt={p.name} />
                <button title="빼기" onClick={() => setPending((ps) => ps.filter((_, j) => j !== k))}>{Icon.x}</button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={taRef}
          value={input}
          rows={1}
          placeholder={empty ? "무엇이든 시켜 보세요" : "답장하기…"}
          onChange={(e) => setInput(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.some((f) => f.type.startsWith("image/"))) { e.preventDefault(); addFiles(files); }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
          }}
        />
        <div className="composer-row">
          <button className="icon-btn round" title="이미지 첨부" onClick={() => fileRef.current?.click()} disabled={busy}>{Icon.clip}</button>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          <div className="spacer" />
          <select className="model" value={model} onChange={(e) => setModel(e.target.value)} disabled={busy}>
            {models.map((m) => <option key={m}>{m}</option>)}
          </select>
          {busy
            ? <button className="send stop" onClick={stop} title="중단">{Icon.stop}</button>
            : <button className="send" onClick={send} disabled={(!input.trim() && !pending.length) || !model} title="보내기">{Icon.up}</button>}
        </div>
      </div>
      {!empty && <div className="disclaimer">에이전트는 이 PC 에서 코드를 실행합니다. 결과를 확인하세요.</div>}
    </div>
  );

  return (
    <div
      className={"shell" + (side ? " side-open" : "")}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDrag(false); }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
    >
      <aside className="sidebar">
        <div className="side-top">
          <button className="icon-btn" onClick={() => setSide(false)} title="사이드바 닫기">{Icon.side}</button>
          <span className="brand">Local LLM</span>
        </div>
        <button className="new-chat" onClick={newChat} disabled={busy}><span className="plus">{Icon.plus}</span>새 대화</button>
        <div className="side-label">최근</div>
        <nav className="conv-list">
          {convs.length === 0 && <div className="side-empty">아직 대화가 없습니다</div>}
          {convs.map((c) => (
            <div key={c.id} className={"conv" + (c.id === cur ? " on" : "")} onClick={() => openChat(c)} title={c.title}>
              <span>{c.title}</span>
              <button className="icon-btn del" title="삭제" onClick={(e) => { e.stopPropagation(); deleteChat(c.id); }}>{Icon.x}</button>
            </div>
          ))}
        </nav>
        <div className="side-foot">{model || "모델 없음"}</div>
      </aside>
      {side && <div className="scrim" onClick={() => setSide(false)} />}

      <div className="main">
        <header className="topbar">
          {!side && <button className="icon-btn" onClick={() => setSide(true)} title="사이드바 열기">{Icon.side}</button>}
          {!side && <button className="icon-btn" onClick={newChat} title="새 대화" disabled={busy}>{Icon.plus}</button>}
          <div className="title">{empty ? "" : convs.find((c) => c.id === cur)?.title || msgs.find((m) => m.role === "user")?.text.slice(0, 40)}</div>
        </header>

        {empty ? (
          <div className="welcome">
            <h1><span className="spark">{Icon.spark}</span>{greet}</h1>
            {composer}
            <div className="chips">
              {["오늘 서울 날씨 어때", "구구단 출력하는 프로그램 짜줘", "드론 이미지 3개 찾아줘", "sin 그래프 그려줘"].map((s) => (
                <button key={s} className="chip" onClick={() => { setInput(s); taRef.current?.focus(); }}>{s}</button>
              ))}
            </div>
            {err && <div className="err">{err}</div>}
          </div>
        ) : (
          <>
            <main className="thread">
              {msgs.map((m, i) => {
                const running = busy && i === msgs.length - 1;
                if (m.role === "user")
                  return (
                    <div key={i} className="turn user">
                      {m.images?.length > 0 && (
                        <div className="thumbs">
                          {m.images.map((p) => <img key={p} src={fileUrl(p)} alt={p} onClick={() => setZoom(fileUrl(p))} />)}
                        </div>
                      )}
                      <div className="bubble">{m.text}</div>
                    </div>
                  );
                const imgs = (m.files || []).filter((f) => f.image || IMG_RE.test(f.path));
                const docs = (m.files || []).filter((f) => !(f.image || IMG_RE.test(f.path)));
                return (
                  <div key={i} className="turn assistant">
                    <WorkLog m={m} running={running} />
                    {m.text ? <div className="prose"><Markdown text={m.text} /></div>
                      : running && !m.log && <div className="thinking"><span className="spinner" />생각하는 중…</div>}
                    {imgs.length > 0 && (
                      <div className="gallery">
                        {imgs.map((f) => {
                          const src = `${fileUrl(f.path)}&v=${i}`;
                          return (
                            <figure key={f.path} onClick={() => setZoom(src)} title={f.path}>
                              <img src={src} alt={f.path} loading="lazy" />
                              <figcaption>
                                <span>{f.path.split("/").pop()}</span>
                                <a href={dlUrl(f.path)} download onClick={(e) => e.stopPropagation()} title="다운로드">{Icon.down}</a>
                              </figcaption>
                            </figure>
                          );
                        })}
                      </div>
                    )}
                    {docs.map((f) => (
                      <details key={f.path} className="file-card">
                        <summary>
                          <span className="file-ico">{(f.path.split(".").pop() || "").toUpperCase().slice(0, 4)}</span>
                          <span className="file-name">{f.path.split("/").pop()}<small>{f.path.includes("/") ? f.path : "작업 폴더"}</small></span>
                          <a className="icon-btn" href={dlUrl(f.path)} download onClick={(e) => e.stopPropagation()} title="다운로드">{Icon.down}<span>다운로드</span></a>
                        </summary>
                        <pre>{f.content}</pre>
                      </details>
                    ))}
                    {m.start && !running && (
                      <div className="actions">
                        {m.text && <CopyButton text={m.text} />}
                        <span className="meta">{m.step ? `${m.step}단계 · ` : ""}<Elapsed start={m.start} end={m.end} /></span>
                      </div>
                    )}
                    {running && m.start && <div className="actions"><span className="meta"><Elapsed start={m.start} end={m.end} /></span></div>}
                  </div>
                );
              })}
              {err && <div className="err">{err}</div>}
              <div ref={bottomRef} className="bottom-pad" />
            </main>
            <div className="dock">{composer}</div>
          </>
        )}
      </div>

      {zoom && <div className="zoom" onClick={() => setZoom(null)}><img src={zoom} alt="" /></div>}
      {drag && <div className="dropzone">여기에 이미지를 놓으세요</div>}
    </div>
  );
}
