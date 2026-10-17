// 공용 도구 — 주소·형식·저장소·아이콘·버전
import { useState } from "react";

export const IMG_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;
// 첨부 가능 형식 (백엔드 IMAGE_EXT + DOC_EXT 와 맞춤)
export const ACCEPT = "image/*,.pdf,.csv,.tsv,.xlsx,.xls,.docx,.pptx,.hwp,.hwpx,.txt,.md,.json,.py,.js,.ts,.html,.css,.log,.xml,.yaml,.yml,.sql";
export const DOC_PREVIEW = /\.(pdf|csv|tsv|xlsx|xls|docx|pptx|hwp|hwpx)$/i; // 결과물 창에서 /api/preview 로 보는 형식
export const fileUrl = (p) => `/api/file?path=${encodeURIComponent(p)}`;
export const dlUrl = (p) => `${fileUrl(p)}&download=1`;
export const wsUrl = (p) => "/ws/" + p.split("/").map(encodeURIComponent).join("/");
export const extOf = (p) => (p.split(".").pop() || "").toLowerCase();
export const baseName = (p) => p.split("/").pop();
export const cleanName = (p) => baseName(p).replace(/^\d{4}_\d{6}_/, ""); // 업로드 때 붙인 시각 접두어 빼기
export const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
export const fmtSec = (ms) => (ms < 60000 ? `${(ms / 1000).toFixed(1)}초` : `${Math.floor(ms / 60000)}분 ${Math.round((ms % 60000) / 1000)}초`);
export const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// 결과물 종류 (파일 확장자·코드 언어 → 결과물 창 보기 방식)
export function artKind(nameOrLang) {
  const e = nameOrLang.toLowerCase().replace(/^.*\./, "");
  if (e === "html" || e === "htm") return "html";
  if (e === "svg") return "svg";
  if (e === "mermaid" || e === "mmd") return "mermaid";
  if (e === "jsx" || e === "react") return "react";
  if (DOC_PREVIEW.test("." + e)) return "doc";
  return "code";
}

// 브라우저 저장소 — 막혀 있어도(사생활 보호 모드 등) 화면은 정상 동작
export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 못 해도 무시 */ } },
};

export const readAsDataUrl = (blob) =>
  new Promise((ok, bad) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = bad;
    r.readAsDataURL(blob);
  });

export function saveText(text, name, type = "text/plain;charset=utf-8") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// POST 요청의 SSE 응답을 읽어 이벤트마다 onEvent 호출
export async function streamPost(url, body, onEvent, signal) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
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

// ── 답 버전 (고쳐 보내기·다시 생성) ─────────────────────
// 메시지 i 에 vers(갈래 목록)와 vi(지금 보는 갈래)를 둔다. 각 갈래 = i 부터 끝까지의 메시지 배열.
const strip = ({ vers, vi, ...rest }) => rest;
export function newVersion(list, i) {
  const cur = list[i];
  const vers = cur.vers ? cur.vers.slice() : [];
  vers[cur.vi ?? 0] = [strip(cur), ...list.slice(i + 1)]; // 지금 갈래 보관
  vers.push(null); // 새 갈래 자리 (실행 결과가 msgs 에 쌓임)
  return { vers, vi: vers.length - 1 };
}
export function switchVersion(list, i, k) {
  const cur = list[i];
  const vers = cur.vers.slice();
  vers[cur.vi] = [strip(cur), ...list.slice(i + 1)];
  const tail = vers[k];
  return [...list.slice(0, i), { ...tail[0], vers, vi: k }, ...tail.slice(1)];
}

// ── 대화 → 마크다운 (내보내기) ─────────────────────────
export function toMarkdown(title, msgs) {
  const out = [`# ${title || "대화"}`, "", `_내보낸 시각: ${new Date().toLocaleString()}_`, ""];
  for (const m of msgs) {
    if (m.role === "user") {
      out.push("## 나", "", m.text);
      for (const p of [...(m.images || []), ...(m.files || [])]) out.push(`- 첨부: ${cleanName(p)}`);
    } else {
      out.push("## 에이전트", "", m.text || "");
      for (const f of m.files || []) out.push(`- 파일: ${f.path}`);
      for (const [n, s] of (m.sources || []).entries()) out.push(`${n === 0 ? "\n출처:\n" : ""}${n + 1}. [${s.title || s.url}](${s.url})`);
    }
    out.push("");
  }
  return out.join("\n");
}

// ── 작은 아이콘 (SVG) ──────────────────────────────────
const sv = (d, w = 18, sw = 1.6) => (
  <svg viewBox="0 0 20 20" width={w} height={w} fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);
export const Icon = {
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
  sl: sv(<path d="M12 5l-5 5 5 5" />, 13, 1.8),
  sr: sv(<path d="M8 5l5 5-5 5" />, 13, 1.8),
  x: sv(<path d="M5 5l10 10M15 5 5 15" />, 14, 1.8),
  retry: sv(<path d="M15.5 9.5A5.5 5.5 0 1 1 13.8 5.6M16 3.5v3.5h-3.5" />, 15),
  edit: sv(<path d="M12.5 4.5l3 3L8 15H5v-3zM11 6l3 3" />, 15),
  open: sv(<><path d="M8 4H5.5A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16h9a1.5 1.5 0 0 0 1.5-1.5V12" /><path d="M11 4h5v5M16 4l-7 7" /></>, 15),
  panel: sv(<><rect x="3" y="4" width="14" height="12" rx="2.5" /><path d="M11 4v12" /></>, 15),
  gear: sv(<><circle cx="10" cy="10" r="2.5" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" /></>, 16),
  pin: sv(<path d="M7.5 3.5h5l-.8 4.5 2.8 2.5h-9L8.3 8zM10 10.5V16" />, 14),
  search: sv(<><circle cx="9" cy="9" r="5" /><path d="M13 13l3.5 3.5" /></>, 15),
  mic: sv(<><rect x="7.5" y="3" width="5" height="9" rx="2.5" /><path d="M5 9.5a5 5 0 0 0 10 0M10 14.5V17" /></>),
  up1: sv(<path d="M6.5 9.5V16H4.5V9.5zM6.5 9.5l3-6c1.3 0 2 .8 2 2V8h3.8a1.5 1.5 0 0 1 1.5 1.8l-1 5A1.5 1.5 0 0 1 14.3 16H6.5" />, 15),
  down1: sv(<path d="M6.5 10.5V4H4.5v6.5zM6.5 10.5l3 6c1.3 0 2-.8 2-2V12h3.8a1.5 1.5 0 0 0 1.5-1.8l-1-5A1.5 1.5 0 0 0 14.3 4H6.5" />, 15),
  folder: sv(<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H8l1.5 1.5h6A1.5 1.5 0 0 1 17 8v6.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z" />, 15),
  export: sv(<path d="M10 13V4M6 7.5l4-4 4 4M4.5 12v3.5h11V12" />, 16),
  spark: <svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 2.5l1.7 6.1 6.1 1.7-6.1 1.7L12 18.1l-1.7-6.1-6.1-1.7 6.1-1.7z" fill="currentColor" /></svg>,
};

export function CopyButton({ text, label }) {
  const [ok, setOk] = useState(false);
  return (
    <button className="icon-btn" title="복사"
      onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(text); setOk(true); setTimeout(() => setOk(false), 1200); }}>
      {Icon.copy}{label ? <span>{ok ? "복사됨" : label}</span> : ok && <span>복사됨</span>}
    </button>
  );
}

// < 1/2 > 갈래 넘기기
export function VersionNav({ m, onSwitch, disabled }) {
  if (!m.vers || m.vers.length < 2) return null;
  return (
    <span className="vnav">
      <button className="icon-btn" disabled={disabled || m.vi === 0} onClick={() => onSwitch(m.vi - 1)} title="이전 버전">{Icon.sl}</button>
      <span>{m.vi + 1} / {m.vers.length}</span>
      <button className="icon-btn" disabled={disabled || m.vi === m.vers.length - 1} onClick={() => onSwitch(m.vi + 1)} title="다음 버전">{Icon.sr}</button>
    </span>
  );
}
