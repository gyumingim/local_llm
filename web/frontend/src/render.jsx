// 답 그리기 — 마크다운, 수식, 코드 색, 인용 칩
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import hljs from "highlight.js/lib/common";
import { artKind, CopyButton, Icon, saveText } from "./lib.jsx";

const EXT = { python: "py", py: "py", javascript: "js", js: "js", jsx: "jsx", typescript: "ts", tsx: "tsx", html: "html", css: "css",
  json: "json", bash: "sh", sh: "sh", powershell: "ps1", sql: "sql", java: "java", c: "c", cpp: "cpp", svg: "svg", mermaid: "mmd" };

// 코드 → 색 입힌 HTML (hljs 가 특수문자를 안전하게 바꿔 줌)
export function highlight(code, lang = "") {
  try {
    const l = lang.toLowerCase();
    if (l && hljs.getLanguage(l)) return hljs.highlight(code, { language: l, ignoreIllegals: true }).value;
    if (code.length < 20000) return hljs.highlightAuto(code).value;
  } catch { /* 색 없이 */ }
  return code.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// 모델이 쓰는 \( \) · \[ \] 수식 표기를 remark-math 가 아는 $ · $$ 로 (코드 블록 밖에서만)
function normalizeMath(text) {
  return text.split(/(```[\s\S]*?```|`[^`\n]*`)/).map((part, i) =>
    i % 2 ? part : part
      .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `\n$$\n${m.trim()}\n$$\n`)
      .replace(/^[ \t]*\$\$([^\n]+?)\$\$[ \t]*$/gm, (_, m) => `$$\n${m.trim()}\n$$`) // 한 줄짜리 $$…$$ 도 가운데 큰 수식으로
      .replace(/\\\((.+?)\\\)/g, (_, m) => `$${m}$`)
  ).join("");
}

// 답 안의 코드 상자 — 언어 · 열기/미리보기(오른쪽 창) · 복사 · 파일로 저장
export function CodeBlock({ lang, code, onOpen }) {
  const name = `code.${EXT[lang.toLowerCase()] || (lang ? "txt" : "py")}`;
  const kind = artKind(lang || "py");
  const visual = ["html", "svg", "mermaid", "react"].includes(kind);
  return (
    <div className="code">
      <div className="code-bar">
        <span>{lang || "code"}</span>
        {onOpen && (
          <button className="icon-btn" onClick={() => onOpen({ kind, title: name, code, lang })} title="오른쪽 창에서 열기">
            {Icon.panel}<span>{visual ? "미리보기" : "열기"}</span>
          </button>
        )}
        <CopyButton text={code} label="복사" />
        <button className="icon-btn" onClick={() => saveText(code + "\n", name)} title="파일로 저장">{Icon.down}<span>저장</span></button>
      </div>
      <pre><code className="hljs" dangerouslySetInnerHTML={{ __html: highlight(code, lang) }} /></pre>
    </div>
  );
}

// 마크다운 답 (목록·굵게·표·링크·코드·수식). 출처 링크는 작은 인용 칩으로
export function Markdown({ text, sources = [], onOpen }) {
  const idx = (href) => sources.findIndex((s) => s.url === href);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        a: ({ node, href = "", children }) => {
          const i = idx(href);
          if (i >= 0)
            return <a className="cite" href={href} target="_blank" rel="noreferrer" title={sources[i].title}>{children}<sup>{i + 1}</sup></a>;
          return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
        },
        // 작업 폴더 안 그림(상대 경로)은 아래 그림 목록에 이미 나오므로 본문에서는 뺌
        img: ({ node, src = "", alt }) => (/^https?:/.test(src) ? <img src={src} alt={alt} className="inline-img" /> : null),
        pre: ({ children }) => {
          const c = children?.props || {};
          const lang = /language-([\w+-]+)/.exec(c.className || "")?.[1] || "";
          const code = String(c.children ?? "").replace(/\n$/, "");
          return code.trim() ? <CodeBlock lang={lang} code={code} onOpen={onOpen} /> : null; // 빈 코드 블록은 그리지 않음
        },
      }}
    >
      {normalizeMath(text)}
    </ReactMarkdown>
  );
}
