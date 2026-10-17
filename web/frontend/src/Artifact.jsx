// 오른쪽 결과물 창 (Claude 의 Artifacts 처럼) — HTML · SVG · Mermaid · React · 문서(표/글/PDF) · 코드
import { useEffect, useState } from "react";
import { CopyButton, Icon, dlUrl, extOf, fileUrl, saveText, wsUrl } from "./lib.jsx";
import { highlight } from "./render.jsx";

const VISUAL = ["html", "svg", "mermaid", "react"];
const LABEL = { html: "HTML", svg: "SVG", mermaid: "Mermaid 도표", react: "React", doc: "문서", code: "코드" };
const LANG_OF = { py: "python", js: "javascript", jsx: "javascript", ts: "typescript", html: "html", css: "css", json: "json", md: "markdown", svg: "xml", sql: "sql" };
const CDN = {
  react: "https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js",
  dom: "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js",
  babel: "https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.26.4/babel.min.js",
  tailwind: "https://cdn.tailwindcss.com/3.4.16",
};
const ERR_SCRIPT = `<script>window.onerror=function(m){document.body.insertAdjacentHTML('afterbegin','<pre style="color:#b5402b;white-space:pre-wrap;padding:12px;margin:0">'+String(m).replace(/</g,'&lt;')+'</pre>')}</script>`;

// React 컴포넌트 코드 → 혼자 도는 HTML (React·Babel·Tailwind 는 CDN — 인터넷 필요)
function reactDoc(code) {
  let name = "App";
  let src = code.replace(/^\s*import\s[^\n]*$/gm, "");
  src = src.replace(/export\s+default\s+function\s+(\w+)/, (_, n) => { name = n; return "function " + n; });
  src = src.replace(/export\s+default\s+(\w+)\s*;?/, (_, n) => { name = n; return ""; });
  src = src.replace(/export\s+(?=const|let|function|class)/g, "").replace(/<\/script/gi, "<\\/script");
  return `<!doctype html><html><head><meta charset="utf-8">${ERR_SCRIPT}
<script src="${CDN.tailwind}"></script><script crossorigin src="${CDN.react}"></script><script crossorigin src="${CDN.dom}"></script><script crossorigin src="${CDN.babel}"></script>
</head><body><div id="root"></div><script type="text/babel" data-presets="react">
const { useState, useEffect, useRef, useMemo, useCallback, useReducer, Fragment } = React;
${src}
ReactDOM.createRoot(document.getElementById("root")).render(<${name} />);
</script></body></html>`;
}
const svgDoc = (svg) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;display:grid;place-items:center;background:#fff}svg{max-width:96vw;max-height:96vh}</style></head><body>${svg}</body></html>`;

let mermaidLoad = null; // 처음 쓸 때만 불러옴 (용량이 커서)
async function renderMermaid(code) {
  mermaidLoad ||= import("mermaid").then((m) => { m.default.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" }); return m.default; });
  const mermaid = await mermaidLoad;
  const { svg } = await mermaid.render("m" + Math.random().toString(36).slice(2), code);
  return svg;
}

function DocPreview({ path }) {
  const [p, setP] = useState(null);
  const [sheet, setSheet] = useState(0);
  useEffect(() => { setP(null); setSheet(0); fetch(`/api/preview?path=${encodeURIComponent(path)}`).then((r) => r.json()).then(setP).catch((e) => setP({ kind: "text", text: String(e) })); }, [path]);
  if (!p) return <div className="art-empty">불러오는 중…</div>;
  if (p.kind === "pdf") return <iframe className="art-frame" title={path} src={fileUrl(path)} />;
  if (p.kind === "image") return <div className="art-img"><img src={fileUrl(path)} alt={path} /></div>;
  if (p.kind === "table") {
    const s = p.sheets[sheet] || { columns: [], rows: [] };
    return (
      <div className="art-table-wrap">
        {p.sheets.length > 1 && (
          <div className="sheet-tabs">{p.sheets.map((x, i) => <button key={i} className={i === sheet ? "on" : ""} onClick={() => setSheet(i)}>{x.name}</button>)}</div>
        )}
        <div className="art-table">
          <table>
            <thead><tr><th>#</th>{s.columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
            <tbody>{s.rows.map((r, i) => <tr key={i}><td>{i + 1}</td>{r.map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody>
          </table>
          {s.rows.length >= 200 && <div className="hint pad">앞 200행만 보입니다 — 전체는 다운로드</div>}
        </div>
      </div>
    );
  }
  return <pre className="art-text">{p.text}</pre>;
}

// versions: 같은 파일의 이전 버전들 [{label, code}] (최신이 마지막)
export default function ArtifactPanel({ art, versions = [], onClose }) {
  const visual = VISUAL.includes(art.kind);
  const [tab, setTab] = useState(visual || art.kind === "doc" ? "preview" : "code");
  const [ver, setVer] = useState(versions.length - 1);
  const [code, setCode] = useState(art.code ?? null);
  const [mmd, setMmd] = useState(null);
  const latest = ver === versions.length - 1 || versions.length < 2;
  const shown = latest ? code : versions[ver]?.code ?? code;
  useEffect(() => {
    if (code === null && art.path && art.kind !== "doc") fetch(fileUrl(art.path)).then((r) => r.text()).then(setCode).catch(() => setCode("(읽지 못함)"));
  }, [code, art]);
  useEffect(() => {
    if (art.kind !== "mermaid" || !shown) return;
    setMmd(null);
    renderMermaid(shown).then((svg) => setMmd({ svg })).catch((e) => setMmd({ err: String(e.message || e) }));
  }, [art.kind, shown]);

  const lines = (shown || "").split("\n");
  const lang = art.lang || LANG_OF[extOf(art.title)] || "";
  let frame = null;
  if (tab === "preview" && visual && shown !== null) {
    let doc = null;
    if (art.kind === "html") doc = latest && art.path ? null : shown;
    if (art.kind === "svg") doc = svgDoc(shown);
    if (art.kind === "react") doc = reactDoc(shown);
    if (art.kind === "mermaid") doc = mmd?.svg ? svgDoc(mmd.svg) : null;
    if (art.kind === "mermaid" && !mmd) frame = <div className="art-empty">도표 그리는 중…</div>;
    else if (art.kind === "mermaid" && mmd?.err) frame = <pre className="art-text err-text">Mermaid 오류: {mmd.err}</pre>;
    else
      frame = (
        <iframe
          key={ver + art.title}
          title={art.title}
          className="art-frame"
          sandbox="allow-scripts allow-forms allow-modals allow-popups"
          {...(doc === null ? { src: wsUrl(art.path) } : { srcDoc: doc })}
        />
      );
  }

  return (
    <aside className="artifact">
      <div className="art-head">
        <div className="art-title">
          <span>{art.title}</span>
          <small>{LABEL[art.kind]}{art.kind === "react" ? " · React/Tailwind 는 인터넷에서 불러옴" : visual ? " · 격리된 창에서 실행" : lang ? ` · ${lang}` : ""}</small>
        </div>
        {versions.length > 1 && (
          <select className="ver-select" value={ver} onChange={(e) => setVer(+e.target.value)} title="버전">
            {versions.map((v, i) => <option key={i} value={i}>v{i + 1}{i === versions.length - 1 ? " (최신)" : ""}</option>)}
          </select>
        )}
        {visual && (
          <div className="seg">
            <button className={tab === "preview" ? "on" : ""} onClick={() => setTab("preview")}>미리보기</button>
            <button className={tab === "code" ? "on" : ""} onClick={() => setTab("code")}>코드</button>
          </div>
        )}
        {shown && art.kind !== "doc" && <CopyButton text={shown} />}
        {art.path
          ? <a className="icon-btn" href={dlUrl(art.path)} download title="다운로드">{Icon.down}</a>
          : shown && <button className="icon-btn" onClick={() => saveText(shown, art.title)} title="저장">{Icon.down}</button>}
        {art.path && (art.kind === "html" || art.kind === "doc") && (
          <a className="icon-btn" href={art.kind === "html" ? wsUrl(art.path) : fileUrl(art.path)} target="_blank" rel="noreferrer" title="새 탭에서 열기">{Icon.open}</a>
        )}
        <button className="icon-btn" onClick={onClose} title="닫기">{Icon.x}</button>
      </div>
      <div className="art-body">
        {art.kind === "doc" ? <DocPreview path={art.path} />
          : frame ?? (
            <div className="art-code">
              <pre className="nums">{lines.map((_, i) => i + 1).join("\n")}</pre>
              <pre className="src"><code className="hljs" dangerouslySetInnerHTML={{ __html: shown === null ? "불러오는 중…" : highlight(shown, lang) }} /></pre>
            </div>
          )}
      </div>
    </aside>
  );
}
