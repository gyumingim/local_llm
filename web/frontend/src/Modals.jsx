// 겹쳐 뜨는 창 — 사진 크게 보기, 설정(지침·기억), 프로젝트
import { useEffect, useRef, useState } from "react";
import { ACCEPT, Icon, cleanName, domainOf, extOf, readAsDataUrl } from "./lib.jsx";

// 사진 크게 보기 (← → 로 넘기기, Esc 닫기)
export function Lightbox({ box, setBox }) {
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

function Modal({ title, onClose, children }) {
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose}>{Icon.x}</button></div>
        {children}
      </div>
    </div>
  );
}

// 설정 — 공통 지침 + 기억
export function Settings({ instructions, setInstructions, onClose }) {
  const [mem, setMem] = useState(null);
  const [draft, setDraft] = useState(instructions);
  useEffect(() => { fetch("/api/memory").then((r) => r.json()).then((d) => setMem(d.items)).catch(() => setMem([])); }, []);
  const del = (i) => fetch(`/api/memory/${i}`, { method: "DELETE" }).then((r) => r.json()).then((d) => setMem(d.items));
  return (
    <Modal title="설정" onClose={onClose}>
      <h3>공통 지침</h3>
      <p className="hint">모든 대화의 모든 요청에 함께 보냅니다. 예: “항상 한국어로 답해”, “코드는 꼭 파일로 저장해”. 프로젝트별 지침은 프로젝트 설정에서.</p>
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
    </Modal>
  );
}

// 프로젝트 — 이름 · 지침 · 자료 파일 (그 프로젝트의 모든 대화에 적용)
export function ProjectModal({ project, onSave, onDelete, onClose }) {
  const [p, setP] = useState(project);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);
  async function addFiles(list) {
    setUploading(true); setErr("");
    try {
      const added = [];
      for (const f of list) {
        const r = await fetch("/api/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: f.name, data: await readAsDataUrl(f) }) });
        if (!r.ok) throw new Error(await r.text());
        added.push((await r.json()).path);
      }
      setP((x) => ({ ...x, files: [...x.files, ...added] }));
    } catch (e) { setErr("올리기 실패: " + e.message); }
    setUploading(false);
  }
  const isNew = !project.name;
  return (
    <Modal title={isNew ? "새 프로젝트" : "프로젝트 설정"} onClose={onClose}>
      <h3>이름</h3>
      <input className="ins one" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} placeholder="예: 졸업 논문, 드론 설계" autoFocus />
      <h3>프로젝트 지침</h3>
      <p className="hint">이 프로젝트의 대화에만 적용됩니다. 예: “파이썬 3.10 기준”, “답은 표로 정리”.</p>
      <textarea className="ins" rows={4} value={p.instructions} onChange={(e) => setP({ ...p, instructions: e.target.value })} />
      <h3>자료 파일 ({p.files.length})</h3>
      <p className="hint">질문과 관련 있으면 에이전트가 읽어 참고합니다. PDF · 한글 · Word · 엑셀 · 텍스트 등.</p>
      <div className="mem-list">
        {p.files.map((f) => (
          <div key={f} className="mem">
            <span className="file-ico sm">{extOf(f).toUpperCase().slice(0, 4)}</span><span>{cleanName(f)}</span>
            <button className="icon-btn" onClick={() => setP({ ...p, files: p.files.filter((x) => x !== f) })} title="빼기">{Icon.x}</button>
          </div>
        ))}
      </div>
      <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { addFiles([...e.target.files]); e.target.value = ""; }} />
      <button className="btn ghost add-file" onClick={() => fileRef.current?.click()} disabled={uploading}>{Icon.clip}{uploading ? "올리는 중…" : "자료 추가"}</button>
      {err && <div className="err left">{err}</div>}
      <div className="modal-row bottom">
        {!isNew ? <button className="btn danger" onClick={() => onDelete(p.id)}>프로젝트 삭제</button> : <span />}
        <button className="btn" onClick={() => onSave({ ...p, name: p.name.trim() || "이름 없는 프로젝트" })}>저장</button>
      </div>
    </Modal>
  );
}
