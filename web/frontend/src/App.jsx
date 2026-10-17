import { useEffect, useMemo, useRef, useState } from "react";
import {
  ACCEPT, CopyButton, IMG_RE, Icon, VersionNav, artKind, baseName, cleanName, dlUrl, domainOf, extOf, fileUrl, fmtSec, fmtSize,
  newId, newVersion, readAsDataUrl, saveText, store, streamPost, switchVersion, toMarkdown,
} from "./lib.jsx";
import { Markdown } from "./render.jsx";
import ArtifactPanel from "./Artifact.jsx";
import { Lightbox, ProjectModal, Settings } from "./Modals.jsx";

const STYLES = {
  "": { label: "기본 스타일", text: "" },
  concise: { label: "간결하게", text: "답은 핵심만 짧고 간결하게 써라." },
  explain: { label: "자세히 설명", text: "초보자도 이해하도록 단계별로 자세히, 예시를 들어 설명하라." },
  formal: { label: "격식체", text: "보고서처럼 격식 있는 문체(-습니다)로, 제목과 목록을 써서 정리하라." },
};
const LONG_PASTE = 2000; // 이보다 긴 붙여넣기는 첨부 파일로
const Speech = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);

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

// 출처 카드
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

export default function App() {
  const [models, setModels] = useState([]);
  const [model, setModel] = useState(store.get("model", ""));
  const [convs, setConvs] = useState(() => store.get("convs", [])); // [{id, title, customTitle, pinned, projectId, msgs, updated}]
  const [cur, setCur] = useState(() => store.get("cur", null));
  const [msgs, setMsgs] = useState(() => store.get("convs", []).find((c) => c.id === store.get("cur", null))?.msgs || []);
  const [projects, setProjects] = useState(() => store.get("projects", [])); // [{id, name, instructions, files}]
  const [activeProject, setActiveProject] = useState(() => store.get("activeProject", ""));
  const [input, setInput] = useState("");
  const [pending, setPending] = useState([]); // 보내기 전 첨부 [{name, dataUrl, image, size, pasted}]
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [box, setBox] = useState(null); // 사진 크게 보기 {list, i}
  const [art, setArt] = useState(null); // 오른쪽 결과물 창
  const [side, setSide] = useState(() => store.get("side", window.innerWidth > 900));
  const [modal, setModal] = useState(null); // "settings" | {project}
  const [instructions, setInstructionsState] = useState(() => store.get("instructions", ""));
  const [style, setStyle] = useState(() => store.get("style", ""));
  const [edit, setEdit] = useState(null); // {i, text} 내 메시지 고치는 중
  const [q, setQ] = useState(""); // 대화 검색
  const [rename, setRename] = useState(null); // {id, text}
  const [listening, setListening] = useState(false);
  const abortRef = useRef(null);
  const runIdRef = useRef(null);
  const bottomRef = useRef(null);
  const fileRef = useRef(null);
  const taRef = useRef(null);
  const recRef = useRef(null);

  const setInstructions = (v) => { setInstructionsState(v); store.set("instructions", v); };
  const curConv = convs.find((c) => c.id === cur);
  const projectId = curConv ? curConv.projectId || "" : activeProject; // 지금 대화가 속한 프로젝트
  const project = projects.find((p) => p.id === projectId);

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
  useEffect(() => { store.set("style", style); }, [style]);
  useEffect(() => { store.set("projects", projects); }, [projects]);
  useEffect(() => { store.set("activeProject", activeProject); }, [activeProject]);
  const last = msgs[msgs.length - 1];
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs.length, last?.text, last?.live]);
  useEffect(() => {
    const t = taRef.current;
    if (t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 240) + "px"; }
  }, [input]);

  // 대화 저장 (실행 중엔 끝난 뒤 한 번만). 이름 바꾼 것·고정·프로젝트는 유지
  useEffect(() => {
    if (busy || !cur || !msgs.length) return;
    setConvs((cs) => {
      const old = cs.find((c) => c.id === cur);
      const auto = msgs.find((m) => m.role === "user")?.text.slice(0, 40) || "새 대화";
      const slim = msgs.map((m) => ({ ...m, live: undefined, log: m.log?.slice(-20000) }));
      const conv = { ...old, id: cur, title: old?.customTitle ? old.title : auto, msgs: slim, updated: Date.now(), projectId: old ? old.projectId || "" : activeProject };
      const next = [conv, ...cs.filter((c) => c.id !== cur)].slice(0, 80);
      store.set("convs", next);
      return next;
    });
    store.set("cur", cur);
  }, [busy, msgs, cur]);

  const saveConvs = (fn) => setConvs((cs) => { const next = fn(cs); store.set("convs", next); return next; });
  const patchLast = (fn) => setMsgs((m) => { const c = m.slice(); c[c.length - 1] = fn({ ...c[c.length - 1] }); return c; });

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
    saveConvs((cs) => cs.filter((c) => c.id !== id));
    if (id === cur) newChat();
  }
  function exportChat() {
    const title = curConv?.title || msgs.find((m) => m.role === "user")?.text.slice(0, 40) || "대화";
    saveText(toMarkdown(title, msgs), `${title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 40)}.md`, "text/markdown;charset=utf-8");
  }

  async function addFiles(fileList) {
    const list = [...fileList];
    const ok = list.filter((f) => f.type.startsWith("image/") || ACCEPT.includes("." + extOf(f.name)));
    if (ok.length < list.length) setErr("올릴 수 없는 형식은 뺐습니다 (가능: 이미지, PDF, 한글, Word, 엑셀, 파워포인트, 텍스트, 코드)");
    if (!ok.length) return;
    const added = await Promise.all(ok.map(async (f) => ({
      name: f.name || "pasted.png", dataUrl: await readAsDataUrl(f), image: f.type.startsWith("image/"), size: f.size,
    })));
    setPending((p) => [...p, ...added]);
  }
  async function addPastedText(text) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const n = pending.filter((p) => p.pasted).length + 1;
    setPending((p) => [...p, { name: `붙여넣은_글${n > 1 ? "_" + n : ""}.txt`, dataUrl: "", image: false, size: blob.size, pasted: true, text }]);
    const dataUrl = await readAsDataUrl(blob);
    setPending((p) => p.map((x) => (x.text === text ? { ...x, dataUrl } : x)));
  }

  // 요청 하나 실행 — prefix 의 마지막은 이번에 답할 내 메시지. extra 는 새 답 메시지에 붙일 것(버전 정보)
  async function run(prefix, extra = {}) {
    const user = prefix[prefix.length - 1];
    setErr("");
    setBusy(true);
    if (!cur) setCur(newId());
    setMsgs([...prefix, { role: "assistant", text: "", log: "", start: Date.now(), ...extra }]);
    const ac = new AbortController();
    abortRef.current = ac;
    const ins = [instructions, project?.instructions, STYLES[style]?.text].filter((s) => s?.trim()).join("\n");
    try {
      let inObs = false;
      let stepBuf = "";   // 이번 단계에 모델이 쓴 글 — FINAL: 이 나오면 그 뒤를 답으로 실시간 표시
      let direct = false; // finalize 단계: 토큰이 곧바로 답
      const hist = prefix.slice(0, -1).slice(-6).map((m) => `${m.role === "user" ? "나" : "AI"}: ${(m.text || "").slice(0, 500)}`).join("\n");
      await streamPost("/api/agent", {
        model, task: user.text, history: hist, images: user.images || [], files: user.files || [], instructions: ins, knowledge: project?.files || [],
      }, (ev) => {
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
        else if (ev.t === "files") {
          const files = ev.files.filter((f) => !f.path.startsWith("uploads/")); // 올린 첨부는 다시 안 보여 줌
          patchLast((m) => ({ ...m, files }));
          // 보이는 결과물(HTML·SVG·도표·React·문서)은 바로 오른쪽 창에
          const vis = files.find((f) => ["html", "svg", "mermaid", "react", "doc"].includes(artKind(f.path)));
          if (vis) setArt({ kind: artKind(vis.path), title: baseName(vis.path), path: vis.path, code: artKind(vis.path) === "doc" ? null : vis.content });
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
    const allImg = pending.length && pending.every((p) => p.image);
    const text = input.trim() || (pending.length ? (allImg ? "첨부한 이미지를 보고 설명해줘" : "첨부한 파일을 읽고 내용을 요약해줘") : "");
    if (!text || busy || !model) return;
    const images = [], files = [];
    try {
      for (const p of pending) { // 첨부를 먼저 workspace/uploads 에 올림
        const r = await fetch("/api/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: p.name, data: p.dataUrl }) });
        if (!r.ok) throw new Error("첨부 올리기 실패: " + (await r.text()));
        const d = await r.json();
        (d.image ? images : files).push(d.path);
      }
    } catch (e) { setErr(e.message); return; }
    setInput("");
    setPending([]);
    run([...msgs, { role: "user", text, images, files }]);
  }
  // 다시 생성 — 지금 답은 이전 버전으로 남김 (< 1/2 >)
  function regenerate(i) {
    if (busy || msgs[i - 1]?.role !== "user") return;
    run(msgs.slice(0, i), newVersion(msgs, i));
  }
  // 고쳐 보내기 — 원래 질문과 그 뒤 대화는 이전 버전으로 남김
  function saveEdit() {
    const { i, text } = edit;
    setEdit(null);
    if (!text.trim() || busy || text.trim() === msgs[i].text) return;
    const u = msgs[i];
    run([...msgs.slice(0, i), { role: "user", text: text.trim(), images: u.images || [], files: u.files || [], ...newVersion(msgs, i) }]);
  }
  const switchTo = (i, k) => { if (!busy) { setMsgs((list) => switchVersion(list, i, k)); setArt(null); } };

  function rate(i, v) {
    const m = msgs[i];
    const rating = m.rating === v ? 0 : v;
    setMsgs((list) => list.map((x, j) => (j === i ? { ...x, rating } : x)));
    if (rating) fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating, task: msgs[i - 1]?.text || "", answer: m.text || "", model }) });
  }

  function stop() {
    if (runIdRef.current) fetch(`/api/stop/${runIdRef.current}`, { method: "POST" });
    abortRef.current?.abort();
  }

  // 음성 입력 (브라우저 음성 인식 — 음성이 브라우저 회사 서버로 전송됨)
  function toggleVoice() {
    if (listening) { recRef.current?.stop(); return; }
    const rec = new Speech();
    rec.lang = "ko-KR";
    rec.interimResults = true;
    rec.continuous = true;
    const base = input ? input.replace(/\s*$/, " ") : "";
    rec.onresult = (e) => setInput(base + [...e.results].map((r) => r[0].transcript).join(""));
    rec.onend = () => setListening(false);
    rec.onerror = (e) => { setListening(false); if (e.error !== "aborted") setErr("음성 인식 오류: " + e.error); };
    recRef.current = rec;
    rec.start();
    setListening(true);
  }

  // 프로젝트
  function saveProject(p) {
    const isNew = !projects.some((x) => x.id === p.id);
    setProjects((ps) => (isNew ? [...ps, p] : ps.map((x) => (x.id === p.id ? p : x))));
    setActiveProject(p.id);
    setModal(null);
    if (isNew) newChatInProject();
  }
  function newChatInProject() { setCur(null); setMsgs([]); setArt(null); store.set("cur", null); }
  function deleteProject(id) {
    setProjects((ps) => ps.filter((x) => x.id !== id));
    saveConvs((cs) => cs.map((c) => (c.projectId === id ? { ...c, projectId: "" } : c))); // 대화는 남기고 프로젝트만 해제
    setActiveProject("");
    setModal(null);
  }

  // 사이드바 목록 — 프로젝트·검색으로 거르고, 고정한 것 먼저
  const shownConvs = useMemo(() => {
    const k = q.trim().toLowerCase();
    return convs
      .filter((c) => !activeProject || c.projectId === activeProject)
      .filter((c) => !k || c.title.toLowerCase().includes(k) || c.msgs.some((m) => (m.text || "").toLowerCase().includes(k)));
  }, [convs, activeProject, q]);
  const pinned = shownConvs.filter((c) => c.pinned);
  const recent = shownConvs.filter((c) => !c.pinned);

  // 같은 파일의 버전들 (대화 안에서 에이전트가 여러 번 고친 경우)
  const artVersions = useMemo(() => {
    if (!art?.path) return [];
    return msgs.flatMap((m) => (m.files || []).filter((f) => f.path === art.path && typeof f.content === "string").map((f) => ({ code: f.content })));
  }, [art, msgs]);
  const openFile = (f) => {
    const kind = artKind(f.path);
    setArt({ kind, title: cleanName(f.path), path: f.path, code: kind === "doc" ? null : f.content });
  };

  const empty = msgs.length === 0;
  const hour = new Date().getHours();
  const greet = hour < 6 ? "늦은 밤이네요" : hour < 12 ? "좋은 아침이에요" : hour < 18 ? "좋은 오후예요" : "좋은 저녁이에요";
  const lastIdx = msgs.length - 1;

  const convItem = (c) => (
    <div key={c.id} className={"conv" + (c.id === cur ? " on" : "")} onClick={() => rename?.id !== c.id && openChat(c)} title={c.title}>
      {rename?.id === c.id ? (
        <input className="rename" value={rename.text} autoFocus onClick={(e) => e.stopPropagation()}
          onChange={(e) => setRename({ id: c.id, text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") { saveConvs((cs) => cs.map((x) => (x.id === c.id ? { ...x, title: rename.text.trim() || x.title, customTitle: true } : x))); setRename(null); }
            if (e.key === "Escape") setRename(null);
          }}
          onBlur={() => setRename(null)} />
      ) : (
        <>
          {c.pinned && <span className="pin-mark">{Icon.pin}</span>}
          <span className="conv-title">{c.title}</span>
          <span className="conv-btns">
            <button className="icon-btn" title={c.pinned ? "고정 해제" : "고정"} onClick={(e) => { e.stopPropagation(); saveConvs((cs) => cs.map((x) => (x.id === c.id ? { ...x, pinned: !x.pinned } : x))); }}>{Icon.pin}</button>
            <button className="icon-btn" title="이름 바꾸기" onClick={(e) => { e.stopPropagation(); setRename({ id: c.id, text: c.title }); }}>{Icon.edit}</button>
            <button className="icon-btn" title="삭제" onClick={(e) => { e.stopPropagation(); deleteChat(c.id); }}>{Icon.x}</button>
          </span>
        </>
      )}
    </div>
  );

  const composer = (
    <div className="composer-wrap">
      <div className="composer">
        {pending.length > 0 && (
          <div className="pending">
            {pending.map((p, k) => (
              <div key={k} className={"pend" + (p.image ? "" : " doc")}>
                {p.image ? <img src={p.dataUrl} alt={p.name} />
                  : <><span className={"file-ico sm" + (p.pasted ? " pasted" : "")}>{p.pasted ? "글" : extOf(p.name).toUpperCase().slice(0, 4)}</span>
                    <span className="pend-name">{p.name}<small>{p.pasted ? `${p.text.length.toLocaleString()}자 붙여넣음` : fmtSize(p.size)}</small></span></>}
                <button title="빼기" onClick={() => setPending((ps) => ps.filter((_, j) => j !== k))}>{Icon.x}</button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={taRef}
          value={input}
          rows={1}
          placeholder={empty ? (project ? `${project.name} — 무엇이든 시켜 보세요` : "무엇이든 시켜 보세요") : "답장하기…"}
          onChange={(e) => setInput(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length) { e.preventDefault(); addFiles(files); return; }
            const text = e.clipboardData.getData("text");
            if (text.length > LONG_PASTE) { e.preventDefault(); addPastedText(text); } // 긴 글은 첨부로
          }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
        />
        <div className="composer-row">
          <button className="icon-btn round" title="파일·이미지 첨부 (PDF, 한글, Word, 엑셀, 파워포인트, 텍스트 …)" onClick={() => fileRef.current?.click()} disabled={busy}>{Icon.clip}</button>
          <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          {Speech && (
            <button className={"icon-btn round" + (listening ? " rec" : "")} onClick={toggleVoice} disabled={busy}
              title={listening ? "듣는 중 — 누르면 멈춤" : "음성 입력 (브라우저 음성 인식: 음성이 브라우저 회사 서버로 전송됩니다)"}>{Icon.mic}</button>
          )}
          <select className="style-sel" value={style} onChange={(e) => setStyle(e.target.value)} title="응답 스타일">
            {Object.entries(STYLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          {(instructions || project?.instructions) && <span className="ins-badge" title={[instructions, project?.instructions].filter(Boolean).join("\n")} onClick={() => setModal(project ? { project } : "settings")}>지침 적용 중</span>}
          <div className="spacer" />
          <select className="model" value={model} onChange={(e) => setModel(e.target.value)} disabled={busy}>
            {models.map((m) => <option key={m}>{m}</option>)}
          </select>
          {busy
            ? <button className="send stop" onClick={stop} title="중단">{Icon.stop}</button>
            : <button className="send" onClick={send} disabled={(!input.trim() && !pending.length) || !model || pending.some((p) => !p.dataUrl)} title="보내기">{Icon.up}</button>}
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
        <div className="proj-row">
          <span className="proj-ico">{Icon.folder}</span>
          <select value={activeProject} onChange={(e) => {
            if (e.target.value === "__new") { setModal({ project: { id: newId(), name: "", instructions: "", files: [] } }); return; }
            setActiveProject(e.target.value); newChatInProject();
          }} disabled={busy}>
            <option value="">모든 대화</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="__new">+ 새 프로젝트…</option>
          </select>
          {activeProject && <button className="icon-btn" title="프로젝트 설정" onClick={() => setModal({ project: projects.find((p) => p.id === activeProject) })}>{Icon.gear}</button>}
        </div>
        <div className="search"><span>{Icon.search}</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="대화 검색" />{q && <button className="icon-btn" onClick={() => setQ("")}>{Icon.x}</button>}</div>
        <nav className="conv-list">
          {pinned.length > 0 && <div className="side-label">고정됨</div>}
          {pinned.map(convItem)}
          {recent.length > 0 && <div className="side-label">최근</div>}
          {recent.map(convItem)}
          {shownConvs.length === 0 && <div className="side-empty">{q ? "검색 결과가 없습니다" : "아직 대화가 없습니다"}</div>}
        </nav>
        <button className="side-foot" onClick={() => setModal("settings")} title="공통 지침·기억 설정">{Icon.gear}<span>설정 · 지침 · 기억</span></button>
      </aside>
      {side && <div className="scrim" onClick={() => setSide(false)} />}

      <div className="main">
        <header className="topbar">
          {!side && <button className="icon-btn" onClick={() => setSide(true)} title="사이드바 열기">{Icon.side}</button>}
          {!side && <button className="icon-btn" onClick={newChat} title="새 대화" disabled={busy}>{Icon.plus}</button>}
          <div className="title">
            {project && <span className="proj-chip">{Icon.folder}{project.name}</span>}
            {empty ? "" : curConv?.title || msgs.find((m) => m.role === "user")?.text.slice(0, 40)}
          </div>
          {!empty && <button className="icon-btn" onClick={exportChat} title="마크다운으로 내보내기" disabled={busy}>{Icon.export}</button>}
        </header>

        {empty ? (
          <div className="welcome">
            <h1><span className="spark">{Icon.spark}</span>{project ? project.name : greet}</h1>
            {composer}
            <div className="chips">
              {["오늘 서울 날씨 어때", "벽돌깨기 게임 HTML 로 만들어줘", "회의록 한글(hwpx) 문서로 만들어줘", "최신 파이썬 버전 웹에서 찾아줘"].map((s) => (
                <button key={s} className="chip" onClick={() => { setInput(s); taRef.current?.focus(); }}>{s}</button>
              ))}
            </div>
            {err && <div className="err">{err}</div>}
          </div>
        ) : (
          <>
            <main className="thread">
              {msgs.map((m, i) => {
                const running = busy && i === lastIdx;
                if (m.role === "user")
                  return (
                    <div key={i} className="turn user">
                      {m.images?.length > 0 && (
                        <div className="thumbs">
                          {m.images.map((p, k) => (
                            <img key={p} src={fileUrl(p)} alt={p} onClick={() => setBox({ list: m.images.map((x) => ({ src: fileUrl(x), dl: dlUrl(x) })), i: k })} />
                          ))}
                        </div>
                      )}
                      {m.files?.length > 0 && (
                        <div className="user-files">
                          {m.files.map((p) => (
                            <button key={p} className="user-file" onClick={() => openFile({ path: p })} title="오른쪽 창에서 보기">
                              <span className="file-ico sm">{extOf(p).toUpperCase().slice(0, 4)}</span><span>{cleanName(p)}</span>
                            </button>
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
                          <div className={"user-actions" + (m.vers?.length > 1 ? " show" : "")}>
                            <VersionNav m={m} disabled={busy} onSwitch={(k) => switchTo(i, k)} />
                            {!busy && <button className="icon-btn" title="고쳐서 다시 보내기" onClick={() => setEdit({ i, text: m.text })}>{Icon.edit}</button>}
                            <CopyButton text={m.text} />
                          </div>
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
                const shownText = m.text || m.live;
                return (
                  <div key={i} className="turn assistant">
                    <WorkLog m={m} running={running} />
                    {shownText ? (
                      <div className={"prose" + (running && m.live ? " streaming" : "")}>
                        <Markdown text={shownText} sources={m.sources} onOpen={setArt} />
                      </div>
                    ) : running && !m.log && <div className="thinking"><span className="spinner" />생각하는 중…</div>}
                    {gallery.length > 0 && (
                      <div className="gallery">
                        {gallery.map((g, k) => (
                          <figure key={g.path} onClick={() => setBox({ list: gallery, i: k })} title={g.caption || g.path}>
                            <img src={g.src} alt={g.caption || g.path} loading="lazy" />
                            <figcaption><span>{g.caption || baseName(g.path)}</span><a href={g.dl} download onClick={(e) => e.stopPropagation()} title="다운로드">{Icon.down}</a></figcaption>
                          </figure>
                        ))}
                      </div>
                    )}
                    {docs.map((f) => {
                      const kind = artKind(f.path);
                      const hint = { html: "누르면 오른쪽에서 실행", svg: "누르면 그림으로 보기", mermaid: "누르면 도표로 보기", react: "누르면 오른쪽에서 실행", doc: "누르면 미리보기" }[kind] || "누르면 오른쪽에서 열기";
                      return (
                        <div key={f.path} className="file-card" role="button" tabIndex={0} onClick={() => openFile(f)}>
                          <span className="file-ico">{extOf(f.path).toUpperCase().slice(0, 4)}</span>
                          <span className="file-name">{baseName(f.path)}<small>{hint}</small></span>
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
                        {!running && m.text && (
                          <>
                            <button className={"icon-btn" + (m.rating === 1 ? " on" : "")} title="좋은 답" onClick={() => rate(i, 1)}>{Icon.up1}</button>
                            <button className={"icon-btn" + (m.rating === -1 ? " on" : "")} title="아쉬운 답" onClick={() => rate(i, -1)}>{Icon.down1}</button>
                          </>
                        )}
                        <VersionNav m={m} disabled={busy} onSwitch={(k) => switchTo(i, k)} />
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

      {/* key: 다른 결과물을 열면 창을 새로 그림 (이전 결과물 코드가 한 번 섞여 실행되던 문제 방지) */}
      {art && <ArtifactPanel key={`${art.kind}:${art.path || ""}:${art.title}:${(art.code || "").length}`} art={art} versions={artVersions} onClose={() => setArt(null)} />}
      {box && <Lightbox box={box} setBox={setBox} />}
      {modal === "settings" && <Settings instructions={instructions} setInstructions={setInstructions} onClose={() => setModal(null)} />}
      {modal?.project && (
        <ProjectModal project={modal.project} onSave={saveProject} onDelete={deleteProject} onClose={() => setModal(null)} />
      )}
      {drag && <div className="dropzone">여기에 파일을 놓으세요</div>}
    </div>
  );
}
