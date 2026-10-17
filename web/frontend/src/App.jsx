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
const LANG_OF = { py: "python", js: "javascript", ts: "typescript", html: "html", css: "css", json: "json", md: "markdown", csv: "csv", txt: "text" };
const IMG_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;
const ACCEPT = "image/*,.pdf,.csv,.xlsx,.xls,.txt,.md,.json,.py,.js,.html,.log,.tsv,.xml,.yaml,.yml";
const fileUrl = (p) => `/api/file?path=${encodeURIComponent(p)}`;
const dlUrl = (p) => `${fileUrl(p)}&download=1`;
const wsUrl = (p) => "/ws/" + p.split("/").map(encodeURIComponent).join("/");
const extOf = (p) => (p.split(".").pop() || "").toLowerCase();
const baseName = (p) => p.split("/").pop();
const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const fmtSec = (ms) => (ms < 60000 ? `${(ms / 1000).toFixed(1)}초` : `${Math.floor(ms / 60000)}분 ${Math.round((ms % 60000) / 1000)}초`);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// 브라우저 저장소 — 대화 목록·지침 기억용 (막혀 있어도 화면은 정상 동작)
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
const sv = (d, w = 18, sw = 1.6) => (
  <svg viewBox="0 0 20 20" width={w} height={w} fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);
const Icon = {
  plus: sv(<path d="M10 4v12M4 10h12" />, 18, 1.8),
  side: sv(<><rect x="3" y="4" width="14" height="12" rx="2.5" /><path d="M8 4v12" /></>),
  up: sv(<path d="M10 15V5M5.5 9.5 10 5l4.5 4.5" />, 18, 2),
  stop: <svg viewBox="0 0 20 20" width="14" height="14"><rect x="5" y="5" width="10" height="10" rx="1.5" fill="currentColor" /></svg>,
  clip: sv(<path d="M13.5 6.5 7.8 12.2a1.6 1.6 0 0 0 2.3 2.3l6-6a3.2 3.2 0 0 0-4.5-4.5l-6.2 6.2a4.8 4.8 0 0 0 6.8 6.8l5.1-5.1" />),
  copy: sv(<><rect x="7" y="7" width="9" height="9" rx="2" /><path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" /></>, 15),
  down: sv(<path d="M10 4v9M6 9.5l4 4 4-4M4.5 16h11" />, 15),
  chev: sv(<path d="M7 5l5 5-5 5" />, 14, 1.8),
  left: sv(<path d="M12.5 4.5 7 10l5.5 5.5" />, 22, 2),
  right: sv(<path d="M7.5 4.5 13 10l-5.5 5.5" />, 22, 2),
  x: sv(<path d="M5 5l10 10M15 5 5 15" />, 14, 1.8),
  retry: sv(<path d="M15.5 9.5A5.5 5.5 0 1 1 13.8 5.6M16 3.5v3.5h-3.5" />, 15),
  edit: sv(<path d="M12.5 4.5l3 3L8 15H5v-3zM11 6l3 3" />, 15),
  open: sv(<><path d="M8 4H5.5A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16h9a1.5 1.5 0 0 0 1.5-1.5V12" /><path d="M11 4h5v5M16 4l-7 7" /></>, 15),
  panel: sv(<><rect x="3" y="4" width="14" height="12" rx="2.5" /><path d="M11 4v12" /></>, 15),
  gear: sv(<><circle cx="10" cy="10" r="2.5" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" /></>, 16),
  spark: <svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 2.5l1.7 6.1 6.1 1.7-6.1 1.7L12 18.1l-1.7-6.1-6.1-1.7 6.1-1.7z" fill="currentColor" /></svg>,
};

function CopyButton({ text, label }) {
  const [ok, setOk] = useState(false);
  return (
    <button className="icon-btn" title="복사"
      onClick={() => { navigator.clipboard?.writeText(text); setOk(true); setTimeout(() => setOk(false), 1200); }}>
      {Icon.copy}{label ? <span>{ok ? "복사됨" : label}</span> : ok && <span>복사됨</span>}
    </button>
  );
}

function saveText(text, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// 답 안의 코드 상자 — 언어 · 열기(오른쪽 창) · 복사 · 파일로 저장
function CodeBlock({ lang, code, onOpen }) {
  const name = `code.${EXT[lang.toLowerCase()] || (lang ? "txt" : "py")}`;
  return (
    <div className="code">
      <div className="code-bar">
        <span>{lang || "code"}</span>
        {onOpen && (
          <button className="icon-btn" onClick={() => onOpen({ kind: lang === "html" ? "html" : "code", title: name, code, lang })} title="오른쪽 창에서 열기">
            {Icon.panel}<span>{lang === "html" ? "미리보기" : "열기"}</span>
          </button>
        )}
        <CopyButton text={code} label="복사" />
        <button className="icon-btn" onClick={() => saveText(code + "\n", name)} title="파일로 저장">{Icon.down}<span>저장</span></button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

// 마크다운 답 (목록·굵게·표·링크·코드). 출처 링크는 작은 인용 칩으로
function Markdown({ text, sources = [], onOpen }) {
  const idx = (href) => sources.findIndex((s) => s.url === href);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ node, href = "", children }) => {
          const i = idx(href);
          if (i >= 0)
            return (
              <a className="cite" href={href} target="_blank" rel="noreferrer" title={sources[i].title}>
                {children}<sup>{i + 1}</sup>
              </a>
            );
          return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
        },
        // 작업 폴더 안 그림(images/x.jpg 같은 상대 경로)은 아래 그림 목록에 이미 나오므로 본문에서는 뺌
        img: ({ node, src = "", alt }) => (/^https?:/.test(src) ? <img src={src} alt={alt} className="inline-img" /> : null),
        pre: ({ children }) => {
          const c = children?.props || {};
          const lang = /language-([\w+-]+)/.exec(c.className || "")?.[1] || "";
          const code = String(c.children ?? "").replace(/\n$/, "");
          return code.trim() ? <CodeBlock lang={lang} code={code} onOpen={onOpen} /> : null; // 빈 코드 블록은 그리지 않음
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function Elapsed({ start, end }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (end) return undefined;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [end]);
  return <span className="elapsed">{fmtSec((end || now) - start)}</span>;
}

// 작업 과정 (접고 펼치기)
function WorkLog({ m, running }) {
  const [open, setOpen] = useState(false);
  if (!m.log) return null;
  const live = running && m.live;
  return (
    <div className={"worklog" + (open ? " open" : "")}>
      <button className="worklog-head" onClick={() => setOpen(!open)}>
        {running && !live ? <span className="spinner" /> : <span className="dot" />}
        <span className="worklog-title">
          {running && !live ? (m.action ? m.action.replace(/^\S+\s/, "") + " 중…" : "생각하는 중…") : "작업 과정"}
        </span>
        <span className="worklog-meta">{m.step ? `${m.step}단계` : ""}</span>
        <span className="chev">{Icon.chev}</span>
      </button>
      {open && <pre className="worklog-body">{m.log.trim()}</pre>}
    </div>
  );
}

// 출처 카드 (웹 검색·페이지·이미지 출처)
function Sources({ items }) {
  const [all, setAll] = useState(false);
  if (!items?.length) return null;
  const shown = all ? items : items.slice(0, 4);
  return (
    <div className="sources">
      <div className="sources-label">출처 {items.length}</div>
      <div className="sources-grid">
        {shown.map((s, i) => (
          <a key={s.url} className="source" href={s.url} target="_blank" rel="noreferrer" title={s.url}>
            <span className="source-top"><span className="fav">{domainOf(s.url).slice(0, 1).toUpperCase()}</span>{domainOf(s.url)}<sup>{i + 1}</sup></span>
            <span className="source-title">{s.title || s.url}</span>
          </a>
        ))}
        {!all && items.length > 4 && <button className="source more" onClick={() => setAll(true)}>+{items.length - 4}개 더 보기</button>}
      </div>
    </div>
  );
}

// 오른쪽 결과물 창 (Claude 의 Artifacts 처럼)
function ArtifactPanel({ art, onClose }) {
  const [tab, setTab] = useState(art.kind === "html" ? "preview" : "code");
  const [code, setCode] = useState(art.code ?? null);
  useEffect(() => { setTab(art.kind === "html" ? "preview" : "code"); setCode(art.code ?? null); }, [art]);
  useEffect(() => {
    if (code === null && art.path) fetch(fileUrl(art.path)).then((r) => r.text()).then(setCode).catch(() => setCode("(읽지 못함)"));
  }, [code, art.path]);
  const lines = (code || "").split("\n");
  const lang = art.lang || LANG_OF[extOf(art.title)] || "";
  return (
    <aside className="artifact">
      <div className="art-head">
        <div className="art-title"><span>{art.title}</span><small>{art.kind === "html" ? "HTML · 격리된 창에서 실행" : lang || "파일"}</small></div>
        {art.kind === "html" && (
          <div className="seg">
            <button className={tab === "preview" ? "on" : ""} onClick={() => setTab("preview")}>미리보기</button>
            <button className={tab === "code" ? "on" : ""} onClick={() => setTab("code")}>코드</button>
          </div>
        )}
        {code && <CopyButton text={code} />}
        {art.path
          ? <a className="icon-btn" href={dlUrl(art.path)} download title="다운로드">{Icon.down}</a>
          : code && <button className="icon-btn" onClick={() => saveText(code, art.title)} title="저장">{Icon.down}</button>}
        {art.path && art.kind === "html" && <a className="icon-btn" href={wsUrl(art.path)} target="_blank" rel="noreferrer" title="새 탭에서 열기">{Icon.open}</a>}
        <button className="icon-btn" onClick={onClose} title="닫기">{Icon.x}</button>
      </div>
      <div className="art-body">
        {tab === "preview" && art.kind === "html" ? (
          <iframe
            title={art.title}
            className="art-frame"
            sandbox="allow-scripts allow-forms allow-modals allow-popups"
            {...(art.path ? { src: wsUrl(art.path) } : { srcDoc: art.code })}
          />
        ) : (
          <div className="art-code">
            <pre className="nums">{lines.map((_, i) => i + 1).join("\n")}</pre>
            <pre className="src"><code>{code ?? "불러오는 중…"}</code></pre>
          </div>
        )}
      </div>
    </aside>
  );
}

// 사진 크게 보기 (← → 로 넘기기)
function Lightbox({ box, setBox }) {
  const { list, i } = box;
  const it = list[i];
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") setBox(null);
      if (e.key === "ArrowRight") setBox((b) => b && { ...b, i: (b.i + 1) % b.list.length });
      if (e.key === "ArrowLeft") setBox((b) => b && { ...b, i: (b.i - 1 + b.list.length) % b.list.length });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setBox]);
  const go = (d) => (e) => { e.stopPropagation(); setBox({ ...box, i: (i + d + list.length) % list.length }); };
  return (
    <div className="lightbox" onClick={() => setBox(null)}>
      <div className="lb-top" onClick={(e) => e.stopPropagation()}>
        <span>{list.length > 1 ? `${i + 1} / ${list.length}` : ""}</span>
        {it.dl && <a className="icon-btn light" href={it.dl} download title="다운로드">{Icon.down}<span>다운로드</span></a>}
        <button className="icon-btn light" onClick={() => setBox(null)} title="닫기 (Esc)">{Icon.x}</button>
      </div>
      {list.length > 1 && <button className="lb-nav prev" onClick={go(-1)} title="이전 (←)">{Icon.left}</button>}
      <img src={it.src} alt={it.caption || ""} onClick={(e) => e.stopPropagation()} />
      {list.length > 1 && <button className="lb-nav next" onClick={go(1)} title="다음 (→)">{Icon.right}</button>}
      {(it.caption || it.source) && (
        <div className="lb-cap" onClick={(e) => e.stopPropagation()}>
          {it.caption}
          {it.source && <a href={it.source} target="_blank" rel="noreferrer">{domainOf(it.source)}</a>}
        </div>
      )}
    </div>
  );
}

// 설정 — 사용자 지침 + 기억
function Settings({ instructions, setInstructions, onClose }) {
  const [mem, setMem] = useState(null);
  const [draft, setDraft] = useState(instructions);
  useEffect(() => { fetch("/api/memory").then((r) => r.json()).then((d) => setMem(d.items)).catch(() => setMem([])); }, []);
  const del = (i) => fetch(`/api/memory/${i}`, { method: "DELETE" }).then((r) => r.json()).then((d) => setMem(d.items));
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>설정</h2><button className="icon-btn" onClick={onClose}>{Icon.x}</button></div>
        <h3>사용자 지침</h3>
        <p className="hint">모든 요청에 함께 보냅니다. 예: “항상 한국어로 답해”, “코드는 꼭 파일로 저장해”, “설명은 짧게”.</p>
        <textarea className="ins" rows={5} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="에이전트가 항상 따를 지침" />
        <div className="modal-row">
          <span className="hint">{draft !== instructions ? "저장 안 됨" : "저장됨"}</span>
          <button className="btn" onClick={() => setInstructions(draft)} disabled={draft === instructions}>저장</button>
        </div>
        <h3>기억 {mem ? `(${mem.length})` : ""}</h3>
        <p className="hint">“내 이름은 … 기억해”처럼 말하면 에이전트가 저장하고, 다음 대화부터 참고합니다. 이 PC 의 <code>agent/memory.json</code> 에 저장됩니다.</p>
        <div className="mem-list">
          {mem === null && <div className="hint">불러오는 중…</div>}
          {mem?.length === 0 && <div className="hint">아직 기억한 것이 없습니다</div>}
          {mem?.map((m, i) => (
            <div key={i} className="mem"><span>{m.text}</span><small>{m.at}</small><button className="icon-btn" onClick={() => del(i)} title="잊기">{Icon.x}</button></div>
          ))}
        </div>
      </div>
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
  const [pending, setPending] = useState([]); // 보내기 전 첨부 [{name, dataUrl, image, size}]
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [box, setBox] = useState(null); // 사진 크게 보기 {list, i}
  const [art, setArt] = useState(null); // 오른쪽 결과물 창
  const [side, setSide] = useState(() => store.get("side", window.innerWidth > 900));
  const [settings, setSettings] = useState(false);
  const [instructions, setInstructionsState] = useState(() => store.get("instructions", ""));
  const [edit, setEdit] = useState(null); // {i, text} 내 메시지 고치는 중
  const abortRef = useRef(null);
  const runIdRef = useRef(null);
  const bottomRef = useRef(null);
  const fileRef = useRef(null);
  const taRef = useRef(null);

  const setInstructions = (v) => { setInstructionsState(v); store.set("instructions", v); };

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
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs.length, msgs[msgs.length - 1]?.text, msgs[msgs.length - 1]?.live]);
  useEffect(() => {
    const t = taRef.current;
    if (t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 240) + "px"; }
  }, [input]);

  // 대화 저장 (실행 중엔 끝난 뒤 한 번만)
  useEffect(() => {
    if (busy || !cur || !msgs.length) return;
    setConvs((cs) => {
      const title = msgs.find((m) => m.role === "user")?.text.slice(0, 40) || "새 대화";
      const slim = msgs.map((m) => ({ ...m, live: undefined, log: m.log?.slice(-20000) }));
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
    setCur(null); setMsgs([]); setErr(""); setArt(null); store.set("cur", null);
    if (window.innerWidth <= 900) setSide(false);
    setTimeout(() => taRef.current?.focus(), 0);
  }
  function openChat(c) {
    if (busy) return;
    setCur(c.id); setMsgs(c.msgs); setErr(""); setArt(null); store.set("cur", c.id);
    if (window.innerWidth <= 900) setSide(false);
  }
  function deleteChat(id) {
    setConvs((cs) => { const next = cs.filter((c) => c.id !== id); store.set("convs", next); return next; });
    if (id === cur) newChat();
  }

  async function addFiles(fileList) {
    const ok = [...fileList].filter((f) => f.type.startsWith("image/") || ACCEPT.includes("." + extOf(f.name)));
    if (ok.length < fileList.length) setErr("올릴 수 없는 형식은 뺐습니다 (가능: 이미지, PDF, CSV, 엑셀, 텍스트, JSON, 코드)");
    if (!ok.length) return;
    const added = await Promise.all(ok.map(async (f) => ({
      name: f.name || "pasted.png", dataUrl: await readAsDataUrl(f), image: f.type.startsWith("image/"), size: f.size,
    })));
    setPending((p) => [...p, ...added]);
  }

  // 요청 하나 실행 — 보내기·다시 생성·고쳐 보내기가 모두 이걸 씀
  async function run({ text, images = [], files = [], history }) {
    setErr("");
    setBusy(true);
    if (!cur) setCur(newId());
    setMsgs([...history, { role: "user", text, images, files }, { role: "assistant", text: "", log: "", start: Date.now() }]);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      let inObs = false;
      let stepBuf = "";   // 이번 단계에 모델이 쓴 글 — FINAL: 이 나오면 그 뒤를 답으로 실시간 표시
      let direct = false; // finalize 단계: 토큰이 곧바로 답
      const hist = history.slice(-6).map((m) => `${m.role === "user" ? "나" : "AI"}: ${(m.text || "").slice(0, 500)}`).join("\n");
      await streamPost("/api/agent", { model, task: text, history: hist, images, files, instructions }, (ev) => {
        if (ev.t === "run") runIdRef.current = ev.id;
        else if (ev.t === "step") { stepBuf = ""; direct = false; patchLast((m) => ({ ...m, step: ev.n, live: "", log: m.log + `\n\n── Step ${ev.n} ──\n` })); }
        else if (ev.t === "finalizing") { stepBuf = ""; direct = true; patchLast((m) => ({ ...m, live: "" })); }
        else if (ev.t === "action") patchLast((m) => ({ ...m, action: ev.d }));
        else if (ev.t === "tok") {
          stepBuf += ev.d;
          let live = null;
          if (direct) live = stepBuf.replace(/^\s*(FINAL:)?\s*/, "");
          else {
            const k = stepBuf.indexOf("FINAL:");
            // 코드와 FINAL 을 같이 쓰면 에이전트가 그 FINAL 을 버리므로 보여 주지 않음
            if (k >= 0 && !stepBuf.slice(0, k).includes("```")) live = stepBuf.slice(k + 6).replace(/^\s+/, "");
          }
          patchLast((m) => ({ ...m, log: m.log + ev.d, ...(live !== null ? { live } : {}) }));
        }
        else if (ev.t === "line") {
          // [Observation] 은 여러 줄로 올 수 있음 → 다음 "--- Step" 줄 전까지 이어지는 줄도 로그에 붙임
          if (ev.d.startsWith("[Observation]")) inObs = true;
          else if (ev.d.startsWith("--- Step") || ev.d.startsWith("FINAL:") || ev.d.startsWith("=== RESULT")) inObs = false;
          if (inObs) patchLast((m) => ({ ...m, log: m.log + "\n" + ev.d }));
        }
        else if (ev.t === "sources")
          patchLast((m) => {
            const have = new Set((m.sources || []).map((s) => s.url));
            return { ...m, sources: [...(m.sources || []), ...ev.items.filter((s) => s.url && !have.has(s.url) && have.add(s.url))] };
          });
        else if (ev.t === "caption") patchLast((m) => ({ ...m, captions: { ...(m.captions || {}), [ev.path]: { text: ev.text, source: ev.source } } }));
        else if (ev.t === "memory") patchLast((m) => ({ ...m, memory: [...(m.memory || []), ev.text] }));
        // 사용자가 올린 첨부(uploads/)는 답 아래에 다시 보여 줄 필요 없음
        else if (ev.t === "files") {
          const files = ev.files.filter((f) => !f.path.startsWith("uploads/"));
          patchLast((m) => ({ ...m, files }));
          const html = files.find((f) => extOf(f.path) === "html");
          if (html) setArt({ kind: "html", title: baseName(html.path), path: html.path, code: html.content }); // HTML 결과물은 바로 오른쪽 창에
        }
        else if (ev.t === "end")
          patchLast((m) => ({ ...m, live: "", text: ev.final || m.live || "작업이 도중에 멈췄습니다. 작업 과정을 확인하고 \"이어서 해줘\"라고 해 보세요." }));
      }, ac.signal);
    } catch (e) {
      if (e.name !== "AbortError") setErr(e.message);
      else patchLast((m) => ({ ...m, text: m.text || m.live || "(중단됨)", live: "" }));
    } finally {
      patchLast((m) => (m.role === "assistant" && !m.end ? { ...m, end: Date.now() } : m));
      setBusy(false);
      abortRef.current = null;
      runIdRef.current = null;
    }
  }

  async function send() {
    const text = input.trim() || (pending.length ? (pending.every((p) => p.image) ? "첨부한 이미지를 보고 설명해줘" : "첨부한 파일을 읽고 내용을 요약해줘") : "");
    if (!text || busy || !model) return;
    const images = [], files = [];
    try {
      for (const p of pending) { // 첨부를 먼저 workspace/uploads 에 올림
        const r = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: p.name, data: p.dataUrl }),
        });
        if (!r.ok) throw new Error("첨부 올리기 실패: " + (await r.text()));
        const d = await r.json();
        (d.image ? images : files).push(d.path);
      }
    } catch (e) {
      setErr(e.message);
      return;
    }
    setInput("");
    setPending([]);
    run({ text, images, files, history: msgs });
  }

  // 답 다시 생성: 그 답 바로 앞의 내 메시지를 같은 첨부로 다시 보냄
  function regenerate(i) {
    if (busy) return;
    const u = msgs[i - 1];
    if (u?.role !== "user") return;
    run({ text: u.text, images: u.images || [], files: u.files || [], history: msgs.slice(0, i - 1) });
  }
  function saveEdit() {
    const { i, text } = edit;
    setEdit(null);
    if (!text.trim() || busy) return;
    const u = msgs[i];
    run({ text: text.trim(), images: u.images || [], files: u.files || [], history: msgs.slice(0, i) });
  }

  function stop() {
    if (runIdRef.current) fetch(`/api/stop/${runIdRef.current}`, { method: "POST" });
    abortRef.current?.abort();
  }

  const empty = msgs.length === 0;
  const hour = new Date().getHours();
  const greet = hour < 6 ? "늦은 밤이네요" : hour < 12 ? "좋은 아침이에요" : hour < 18 ? "좋은 오후예요" : "좋은 저녁이에요";
  const lastAssistant = msgs.length - 1;

  const composer = (
    <div className="composer-wrap">
      <div className="composer">
        {pending.length > 0 && (
          <div className="pending">
            {pending.map((p, k) => (
              <div key={k} className={"pend" + (p.image ? "" : " doc")}>
                {p.image ? <img src={p.dataUrl} alt={p.name} />
                  : <><span className="file-ico sm">{extOf(p.name).toUpperCase().slice(0, 4)}</span><span className="pend-name">{p.name}<small>{fmtSize(p.size)}</small></span></>}
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
            if (files.length) { e.preventDefault(); addFiles(files); }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
          }}
        />
        <div className="composer-row">
          <button className="icon-btn round" title="파일·이미지 첨부 (PDF, CSV, 엑셀, 텍스트 …)" onClick={() => fileRef.current?.click()} disabled={busy}>{Icon.clip}</button>
          <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          {instructions && <span className="ins-badge" title={instructions} onClick={() => setSettings(true)}>지침 적용 중</span>}
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
      className={"shell" + (side ? " side-open" : "") + (art ? " art-open" : "")}
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
        <button className="side-foot" onClick={() => setSettings(true)} title="지침·기억 설정">
          {Icon.gear}<span>설정 · 지침 · 기억</span>
        </button>
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
              {["오늘 서울 날씨 어때", "벽돌깨기 게임 HTML 로 만들어줘", "드론 이미지 3개 찾아줘", "최신 파이썬 버전 웹에서 찾아줘"].map((s) => (
                <button key={s} className="chip" onClick={() => { setInput(s); taRef.current?.focus(); }}>{s}</button>
              ))}
            </div>
            {err && <div className="err">{err}</div>}
          </div>
        ) : (
          <>
            <main className="thread">
              {msgs.map((m, i) => {
                const running = busy && i === lastAssistant;
                if (m.role === "user")
                  return (
                    <div key={i} className="turn user">
                      {m.images?.length > 0 && (
                        <div className="thumbs">
                          {m.images.map((p, k) => (
                            <img key={p} src={fileUrl(p)} alt={p}
                              onClick={() => setBox({ list: m.images.map((q) => ({ src: fileUrl(q), dl: dlUrl(q) })), i: k })} />
                          ))}
                        </div>
                      )}
                      {m.files?.length > 0 && (
                        <div className="user-files">
                          {m.files.map((p) => (
                            <a key={p} className="user-file" href={dlUrl(p)} download title="다운로드">
                              <span className="file-ico sm">{extOf(p).toUpperCase().slice(0, 4)}</span><span>{baseName(p).replace(/^\d{4}_\d{6}_/, "")}</span>
                            </a>
                          ))}
                        </div>
                      )}
                      {edit?.i === i ? (
                        <div className="edit-box">
                          <textarea value={edit.text} autoFocus rows={3} onChange={(e) => setEdit({ i, text: e.target.value })}
                            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); saveEdit(); } if (e.key === "Escape") setEdit(null); }} />
                          <div className="edit-row">
                            <button className="btn ghost" onClick={() => setEdit(null)}>취소</button>
                            <button className="btn" onClick={saveEdit}>보내기</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="bubble">{m.text}</div>
                          {!busy && <div className="user-actions"><button className="icon-btn" title="고쳐서 다시 보내기" onClick={() => setEdit({ i, text: m.text })}>{Icon.edit}</button><CopyButton text={m.text} /></div>}
                        </>
                      )}
                    </div>
                  );
                const imgs = (m.files || []).filter((f) => f.image || IMG_RE.test(f.path));
                const docs = (m.files || []).filter((f) => !(f.image || IMG_RE.test(f.path)));
                const gallery = imgs.map((f) => ({
                  src: `${fileUrl(f.path)}&v=${i}`, dl: dlUrl(f.path), path: f.path,
                  caption: m.captions?.[f.path]?.text || "", source: m.captions?.[f.path]?.source,
                }));
                const shown = m.text || m.live;
                return (
                  <div key={i} className="turn assistant">
                    <WorkLog m={m} running={running} />
                    {shown ? (
                      <div className={"prose" + (running && m.live ? " streaming" : "")}>
                        <Markdown text={m.text || m.live} sources={m.sources} onOpen={setArt} />
                      </div>
                    ) : running && !m.log && <div className="thinking"><span className="spinner" />생각하는 중…</div>}
                    {gallery.length > 0 && (
                      <div className="gallery">
                        {gallery.map((g, k) => (
                          <figure key={g.path} onClick={() => setBox({ list: gallery, i: k })} title={g.caption || g.path}>
                            <img src={g.src} alt={g.caption || g.path} loading="lazy" />
                            <figcaption>
                              <span>{g.caption || baseName(g.path)}</span>
                              <a href={g.dl} download onClick={(e) => e.stopPropagation()} title="다운로드">{Icon.down}</a>
                            </figcaption>
                          </figure>
                        ))}
                      </div>
                    )}
                    {docs.map((f) => {
                      const isHtml = extOf(f.path) === "html";
                      return (
                        <div key={f.path} className="file-card" role="button" tabIndex={0}
                          onClick={() => setArt({ kind: isHtml ? "html" : "code", title: baseName(f.path), path: f.path, code: f.content })}>
                          <span className="file-ico">{extOf(f.path).toUpperCase().slice(0, 4)}</span>
                          <span className="file-name">{baseName(f.path)}<small>{isHtml ? "누르면 오른쪽에서 실행" : "누르면 오른쪽에서 열기"}</small></span>
                          <a className="icon-btn" href={dlUrl(f.path)} download onClick={(e) => e.stopPropagation()} title="다운로드">{Icon.down}<span>다운로드</span></a>
                        </div>
                      );
                    })}
                    {m.memory?.map((t) => <div key={t} className="mem-note">🧠 기억함 — {t}</div>)}
                    {!running && <Sources items={m.sources} />}
                    {m.start && (
                      <div className="actions">
                        {!running && m.text && <CopyButton text={m.text} />}
                        {!running && !busy && <button className="icon-btn" title="다시 생성" onClick={() => regenerate(i)}>{Icon.retry}</button>}
                        <span className="meta">{m.step ? `${m.step}단계 · ` : ""}<Elapsed start={m.start} end={m.end} /></span>
                      </div>
                    )}
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

      {art && <ArtifactPanel art={art} onClose={() => setArt(null)} />}
      {box && <Lightbox box={box} setBox={setBox} />}
      {settings && <Settings instructions={instructions} setInstructions={setInstructions} onClose={() => setSettings(false)} />}
      {drag && <div className="dropzone">여기에 파일을 놓으세요</div>}
    </div>
  );
}
