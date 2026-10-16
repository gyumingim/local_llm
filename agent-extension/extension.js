// Local Agent — codeact(자체 파싱, 로컬 35B로 도구 확실)를 VSCode 채팅 패널로 감싼 확장.
// 기능: 실시간 토큰 스트리밍(AGENT_JSON), 생성중 표시, 출력 정리(사고 접기/코드박스),
//       대화 이어가기(AGENT_HISTORY), 편집 파일 칩, 대화 저장/목록/복원, 파일 첨부(AGENT_ATTACH).
const vscode = require("vscode");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

function cfg(k) { return vscode.workspace.getConfiguration("localAgent").get(k); }

function activate(context) {
  const provider = new ChatProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("localAgent.chat", provider),
    vscode.commands.registerCommand("localAgent.openInEditor", () => provider.openPanel())
  );
}

class ChatProvider {
  constructor(context) {
    this.context = context;
    this.proc = null;
    this.buf = "";
    this.storeFile = path.join(context.globalStorageUri.fsPath, "conversations.json");
    this.conversations = this.load();
    this.current = { id: String(Date.now()), title: "", turns: [], ts: Date.now() };
    this.attachments = [];   // [{name, content}]
  }

  load() {
    try { return JSON.parse(fs.readFileSync(this.storeFile, "utf8")); } catch { return []; }
  }
  save() {
    try {
      fs.mkdirSync(path.dirname(this.storeFile), { recursive: true });
      fs.writeFileSync(this.storeFile, JSON.stringify(this.conversations, null, 2));
    } catch (e) { this.post({ kind: "meta", text: "대화 저장 실패: " + e.message }); }
  }

  archiveCurrent() {
    if (!this.current.turns.length) return;
    this.current.title = this.current.title || this.current.turns[0].text.slice(0, 40);
    const i = this.conversations.findIndex((c) => c.id === this.current.id);
    if (i >= 0) this.conversations[i] = this.current;
    else this.conversations.unshift(this.current);
    if (this.conversations.length > 200) this.conversations.length = 200;  // 무한 증가 방지
    this.save();
  }

  resolveWebviewView(view) { this.bind(view.webview); }

  openPanel() {
    const panel = vscode.window.createWebviewPanel(
      "localAgent.panel", "Local Agent", vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.bind(panel.webview);
  }

  bind(webview) {
    this.view = { webview };
    webview.options = { enableScripts: true };
    webview.html = getHtml();
    webview.onDidReceiveMessage((m) => {
      try {
        if (m.type === "ask") this.runCodeact(m.text);
        else if (m.type === "stop") { if (this.proc) this.proc.kill(); }
        else if (m.type === "new") this.newConversation();
        else if (m.type === "list") this.postList();
        else if (m.type === "select") this.selectConversation(m.id);
        else if (m.type === "delete") this.deleteConversation(m.id);
        else if (m.type === "open") this.openFile(m.path);
        else if (m.type === "attach") this.attachFile();
        else if (m.type === "attachPath") this.attachPaths(m.paths || []);
        else if (m.type === "unattach") { this.attachments = this.attachments.filter((a) => a.name !== m.name); this.postAttach(); }
      } catch (e) { this.post({ kind: "meta", text: "오류: " + e.message }); }
    });
    this.postList();
    this.postAttach();
    this.checkDeps();
    if (cfg("autoProjectMap")) this.buildMap();
  }

  async checkDeps() {
    const host = cfg("ollamaHost") || "http://localhost:11434";
    const model = cfg("model");
    try {
      const res = await fetch(host + "/api/tags");
      const data = await res.json();
      const has = (data.models || []).some((m) => m.name === model);
      if (model && !has) this.post({ kind: "meta", text: `⚠️ 모델 '${model}'이 Ollama에 없습니다 — 터미널에서 'ollama pull ${model}' 실행이 필요합니다.` });
    } catch {
      this.post({ kind: "meta", text: `⚠️ Ollama 연결 안됨 (${host}). Ollama 실행 상태와 설정(localAgent.ollamaHost)을 확인하세요.` });
    }
  }

  // Code RAG: 워크스페이스를 자동 인덱싱 → codeact가 search_codebase로 실제 코드를 검색(환각↓)
  buildIndex() {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) return;
    const idx = path.join(this.context.extensionPath, "indexer.py");
    const idxFile = path.join(this.context.extensionPath, "code_index.json");
    if (!fs.existsSync(idx) || fs.existsSync(idxFile)) return;  // 도구 없거나 이미 인덱싱됨 → 스킵
    try {
      const p = spawn(cfg("pythonPath"), [idx, "index", ws], {
        cwd: this.context.extensionPath,
        env: { ...process.env, OLLAMA_HOST: cfg("ollamaHost") || "http://localhost:11434", PYTHONIOENCODING: "utf-8" },
      });
      p.on("close", (c) => { if (c === 0) this.post({ kind: "meta", text: "🔍 코드 인덱싱 완료 — 실제 코드를 검색해 답합니다 (환각↓)." }); });
    } catch {}
  }

  // PROJECT_MAP: 프로젝트 구조를 md로 압축 생성 → 빠르고 정확한 파악
  buildMap() {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) return;
    const pm = path.join(this.context.extensionPath, "project_map.py");
    const mapFile = path.join(ws, "PROJECT_MAP.md");
    if (!fs.existsSync(pm) || fs.existsSync(mapFile)) return;
    try {
      const p = spawn(cfg("pythonPath"), [pm, ws], { cwd: ws, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
      p.on("close", (c) => { if (c === 0) this.post({ kind: "meta", text: "📄 PROJECT_MAP.md 생성 — 프로젝트 구조를 파악했습니다." }); });
    } catch {}
  }

  newConversation() {
    this.archiveCurrent();
    this.current = { id: String(Date.now()), title: "", turns: [], ts: Date.now() };
    this.post({ kind: "cleared" });
    this.postList();
  }

  selectConversation(id) {
    this.archiveCurrent();
    const c = this.conversations.find((x) => x.id === id);
    if (!c) return;
    this.current = JSON.parse(JSON.stringify(c));
    this.post({ kind: "restore", turns: c.turns });
    this.postList();
  }

  deleteConversation(id) {
    this.conversations = this.conversations.filter((x) => x.id !== id);
    this.save();
    this.postList();
  }

  postList() {
    this.post({
      kind: "list",
      items: this.conversations.map((c) => ({ id: c.id, title: c.title || "(제목 없음)", ts: c.ts })),
      currentId: this.current.id,
    });
  }

  async attachFile() {
    const uris = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: "첨부" });
    if (!uris) return;
    for (const u of uris) {
      try {
        const stat = fs.statSync(u.fsPath);
        if (stat.size > 200 * 1024) { this.post({ kind: "meta", text: `너무 큼(>200KB): ${path.basename(u.fsPath)}` }); continue; }
        const content = fs.readFileSync(u.fsPath, "utf8");
        const name = path.basename(u.fsPath);
        if (!this.attachments.some((a) => a.name === name)) this.attachments.push({ name, content });
      } catch (e) { this.post({ kind: "meta", text: "첨부 실패: " + path.basename(u.fsPath) }); }
    }
    this.postAttach();
  }
  postAttach() { this.post({ kind: "attach", items: this.attachments.map((a) => a.name) }); }

  attachPaths(paths) {
    for (const p of paths) {
      let fp = p;
      try { if (p.startsWith("file:")) fp = vscode.Uri.parse(p.trim()).fsPath; } catch { continue; }
      try {
        const stat = fs.statSync(fp);
        if (!stat.isFile() || stat.size > 200 * 1024) continue;
        const name = path.basename(fp);
        if (!this.attachments.some((a) => a.name === name)) this.attachments.push({ name, content: fs.readFileSync(fp, "utf8") });
      } catch {}
    }
    this.postAttach();
  }

  runCodeact(task) {
    if (this.proc) { this.post({ kind: "meta", text: "이전 작업이 실행 중입니다. 중지 후 다시 시도하세요." }); return; }
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) { this.post({ kind: "meta", text: "열린 폴더(워크스페이스)가 없습니다. 폴더를 열고 다시 시도하세요." }); this.post({ kind: "gen_end" }); return; }

    const histText = this.current.turns.slice(-6).map((h) => `${h.role}: ${h.text}`).join("\n");
    const attachText = this.attachments.map((a) => `--- ${a.name} ---\n${a.content}`).join("\n\n");
    const attachN = this.attachments.length;
    this.result = ""; this.buf = "";
    this.current.turns.push({ role: "나", text: task + (attachN ? ` [첨부 ${attachN}개]` : "") });
    this.post({ kind: "gen_start" });

    const codeactFile = cfg("codeactPath") || path.join(this.context.extensionPath, "codeact_agent.py");
    let proc;
    try {
      proc = spawn(cfg("pythonPath"), [codeactFile, task], {
        cwd: ws,
        env: { ...process.env, AGENT_WORKSPACE: ws, AGENT_HISTORY: histText, AGENT_ATTACH: attachText, AGENT_JSON: "1",
               OLLAMA_HOST: cfg("ollamaHost") || "http://localhost:11434", AGENT_MODEL: cfg("model") || "", PYTHONIOENCODING: "utf-8" },
      });
    } catch (e) {
      this.post({ kind: "meta", text: "실행 실패: " + e.message });
      this.post({ kind: "gen_end" }); return;
    }
    this.proc = proc;
    this.attachments = []; this.postAttach();   // 전송 후 첨부 비움

    // 안정성: 설정한 시간(기본 10분) 넘게 응답 없으면 강제 종료
    const timeoutMin = cfg("timeoutMinutes") || 60;
    const watchdog = setTimeout(() => { if (this.proc === proc) { this.post({ kind: "meta", text: `${timeoutMin}분 초과 — 작업을 중단합니다. 더 구체적으로 시키거나 설정에서 시간을 늘리세요.` }); proc.kill(); } }, timeoutMin * 60000);

    proc.stdout.on("data", (d) => this.onData(d.toString()));
    proc.stderr.on("data", (d) => this.onData(d.toString()));
    proc.on("close", (code) => {
      clearTimeout(watchdog);
      this.flush();
      let answer = this.result;
      if (!answer) {
        // 답이 없으면(중단·에러 등) 무조건 안내 답변을 화면에 표시
        answer = "작업이 도중에 멈췄습니다. 변경한 파일은 이미 반영됐을 수 있어요. **\"이어서 해줘\"**라고 하면 계속하겠습니다. (작업이 크면 더 구체적으로 나눠서 시켜주세요.)";
        this.post({ kind: "line", text: "FINAL: " + answer });
      }
      this.current.turns.push({ role: "AI", text: answer.slice(0, 800) });
      this.archiveCurrent();
      this.post({ kind: "gen_end", text: code === 0 ? "완료" : "중단됨" });
      this.postList();
      this.proc = null;
    });
    proc.on("error", (e) => {
      clearTimeout(watchdog);
      this.post({ kind: "meta", text: `실행 오류: ${e.message} — 설정에서 python/codeact 경로 확인` });
      this.post({ kind: "gen_end" });
      this.proc = null;
    });
  }

  onData(chunk) {
    this.buf += chunk;
    let idx;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      this.emitLine(line);
    }
  }
  flush() { if (this.buf) { this.emitLine(this.buf); this.buf = ""; } }

  emitLine(line) {
    if (line.startsWith("\x1e")) {
      try { this.post({ kind: "event", ev: JSON.parse(line.slice(1)) }); } catch {}
      return;
    }
    if (line.startsWith("FINAL:")) this.result = line.slice(6).trim();
    const m = line.match(/open\(\s*['"]([^'"]+\.[\w]+)['"]\s*,\s*['"][wa]/);
    if (m) this.post({ kind: "file", text: m[1] });
    this.post({ kind: "line", text: line });
  }

  openFile(p) {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
    const full = path.isAbsolute(p) ? p : path.join(ws, p);
    vscode.workspace.openTextDocument(full).then(
      (doc) => vscode.window.showTextDocument(doc),
      () => this.post({ kind: "meta", text: `파일을 열 수 없음: ${p}` })
    );
  }

  post(m) { this.view?.webview.postMessage(m); }
}

function getHtml() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  /* 색은 전부 VSCode 네이티브 테마 변수 — 에디터 테마를 그대로 따라 자연스럽게 녹아듦 (커스텀 색 없음) */
  :root{--ground:var(--vscode-sideBar-background,#1e1e1e);--panel:var(--vscode-editor-background,#252526);
    --panel2:var(--vscode-editorWidget-background,#2d2d30);--border:var(--vscode-panel-border,var(--vscode-editorWidget-border,#3c3c3c));
    --text:var(--vscode-foreground,#ccc);--dim:var(--vscode-descriptionForeground,#999);--faint:var(--vscode-disabledForeground,#777);
    --accent:var(--vscode-textLink-foreground,#3794ff);--accent2:var(--vscode-textLink-activeForeground,#3794ff);
    --user:var(--vscode-button-background,#0e639c);--userfg:var(--vscode-button-foreground,#fff);
    --ok:var(--vscode-charts-green,#89d185);--err:var(--vscode-errorForeground,#f48771);--codebg:var(--vscode-textCodeBlock-background,#1e1e1e);
    --mono:var(--vscode-editor-font-family,ui-monospace,Consolas,monospace);--sans:var(--vscode-font-family,system-ui,sans-serif);}
  *{box-sizing:border-box}
  body{margin:0;background:var(--ground);color:var(--text);font-family:var(--sans);font-size:13px;line-height:1.5;height:100vh;display:flex;flex-direction:column}
  /* 기본: 사고 과정(.proc) 숨기고 답변만. 💭 버튼으로 body.showproc 켜면 전부 표시 */
  body:not(.showproc) .proc{display:none}
  .hbtn.on{color:var(--accent);border-color:var(--accent)}
  body.drag{outline:2px dashed var(--accent);outline-offset:-8px}
  body.drag::after{content:"📎 파일을 놓으면 첨부됩니다";position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--panel2);border:1px solid var(--accent);color:var(--accent);padding:10px 18px;border-radius:8px;font-size:13px;z-index:100;pointer-events:none}
  header{display:flex;align-items:center;gap:7px;padding:8px 10px;border-bottom:1px solid var(--border);background:var(--panel);white-space:nowrap;overflow:hidden}
  header .dot{width:7px;height:7px;border-radius:50%;background:var(--ok);box-shadow:0 0 6px var(--ok);flex-shrink:0}
  header .name{font-weight:600;flex-shrink:0}
  header .model{color:var(--dim);font-size:11px;font-family:var(--mono);background:var(--panel2);padding:2px 7px;border-radius:5px;flex-shrink:1;overflow:hidden;text-overflow:ellipsis;max-width:130px}
  header .sp{flex:1;min-width:0}
  .hbtn{background:transparent;border:1px solid var(--border);color:var(--dim);padding:4px 8px;border-radius:6px;cursor:pointer;font-size:13px;flex-shrink:0;white-space:nowrap;line-height:1}
  .hbtn:hover{color:var(--text);border-color:var(--faint)}
  #log{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:5px}
  .user{align-self:flex-end;max-width:82%;background:var(--user);color:var(--userfg,#fff);padding:7px 11px;border-radius:12px 12px 3px 12px;white-space:pre-wrap;margin:6px 0 2px}
  .ai{align-self:flex-start;max-width:88%;white-space:pre-wrap;padding:2px 0}
  .step-label{display:flex;align-items:center;gap:6px;color:var(--faint);font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;margin-top:8px}
  .step-label::before,.step-label::after{content:"";height:1px;background:var(--border);flex:1}
  details.thought summary{cursor:pointer;color:var(--dim);font-style:italic;font-size:12px;list-style:none;display:flex;gap:6px;padding:2px 0}
  details.thought summary::-webkit-details-marker{display:none}
  details.thought .body{padding:6px 0 6px 16px;color:var(--dim);white-space:pre-wrap;border-left:1px solid var(--border);margin-left:5px}
  .code{background:var(--codebg);border:1px solid var(--border);border-radius:7px;overflow:hidden;margin:4px 0 0}
  .code .bar{display:flex;align-items:center;gap:6px;padding:5px 10px;background:var(--panel2);border-bottom:1px solid var(--border);font-family:var(--sans);font-size:11px;color:var(--dim)}
  .code .bar .run{color:var(--ok);font-size:9px}
  .code .bar .lg{margin-left:auto;font-family:var(--mono);color:var(--faint);font-size:10px}
  .code pre{margin:0;padding:9px 11px;overflow-x:auto;font-family:var(--mono);font-size:12px;white-space:pre}
  .obs{background:var(--panel);border:1px solid var(--border);border-top:none;border-radius:0 0 7px 7px;padding:7px 10px;margin:0 0 4px;font-family:var(--mono);font-size:12px;white-space:pre-wrap}
  .obs .tag{color:var(--faint);font-size:10px;text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:3px}
  .final{display:flex;gap:8px;background:var(--panel2);border:1px solid var(--accent2);border-radius:8px;padding:9px 11px;margin-top:4px}
  .final .ic{color:var(--ok)}.final .txt{font-weight:500}
  .stream{font-family:var(--mono);font-size:12px;white-space:pre-wrap;color:var(--text);padding:2px 0}
  .cursor{display:inline-block;width:7px;height:13px;background:var(--accent);margin-left:1px;vertical-align:text-bottom;animation:blink 1s step-end infinite}
  @keyframes blink{50%{opacity:0}}
  .gen{display:flex;align-items:center;gap:9px;color:var(--dim);font-size:12px;padding:5px 0}
  .spin{width:13px;height:13px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  @media(prefers-reduced-motion:reduce){.spin{animation:none}}
  .gen .el{color:var(--faint);font-variant-numeric:tabular-nums}
  .files{display:flex;flex-wrap:wrap;gap:6px;padding:4px 12px}
  .chip{display:inline-flex;align-items:center;gap:5px;background:var(--panel);border:1px solid var(--border);color:var(--text);padding:4px 9px;border-radius:14px;cursor:pointer;font-size:11.5px;font-family:var(--mono)}
  .chip:hover{border-color:var(--accent);color:var(--accent)}
  .chip .b{background:var(--accent);color:var(--ground);font-size:9px;padding:0 5px;border-radius:8px;font-family:var(--sans)}
  .meta{color:var(--faint);font-style:italic;font-size:11px;margin:3px 0}
  #list{position:absolute;inset:0;background:var(--ground);z-index:10;display:none;flex-direction:column}
  #list.on{display:flex}
  #list .lh{display:flex;align-items:center;padding:10px 12px;border-bottom:1px solid var(--border);font-weight:600}
  #list .lh .sp{flex:1}
  #list .items{flex:1;overflow-y:auto;padding:6px}
  .conv{display:flex;align-items:center;gap:8px;padding:9px 10px;border-radius:7px;cursor:pointer}
  .conv:hover{background:var(--panel)}
  .conv.cur{background:var(--panel2);border:1px solid var(--accent2)}
  .conv .t{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .conv .d{color:var(--faint);font-size:10px}
  .conv .x{color:var(--faint);cursor:pointer;padding:2px 6px;border-radius:4px}
  .conv .x:hover{color:var(--err);background:var(--panel2)}
  .empty{color:var(--faint);text-align:center;padding:30px;font-style:italic}
  .atts{display:flex;flex-wrap:wrap;gap:5px;padding:0 2px 6px}
  .att{display:inline-flex;align-items:center;gap:5px;background:var(--panel2);border:1px solid var(--border);color:var(--text);padding:3px 8px;border-radius:12px;font-size:11px;font-family:var(--mono)}
  .att .x{cursor:pointer;color:var(--faint)}.att .x:hover{color:var(--err)}
  footer{border-top:1px solid var(--border);padding:8px;background:var(--panel);display:flex;flex-direction:column;gap:5px}
  .inbox{display:flex;gap:6px;align-items:flex-end}
  textarea{flex:1;min-height:70px;max-height:220px;background:var(--panel2);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:9px 11px;resize:none;font-family:var(--sans);font-size:13px;line-height:1.5}
  textarea:focus{outline:none;border-color:var(--accent)}
  .iconbtn{height:36px;background:transparent;color:var(--dim);border:1px solid var(--border);border-radius:8px;padding:0 11px;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center}
  .iconbtn:hover{color:var(--text);border-color:var(--faint)}
  .iconbtn.send{background:var(--user);color:var(--userfg);border:none;font-weight:bold}
  .iconbtn.send:hover{opacity:.88;color:var(--userfg)}
  .stopbtn{display:none;align-self:flex-start;background:transparent;color:var(--dim);border:1px solid var(--border);border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer}
  .stopbtn.on{display:block}
  .stopbtn:hover{color:var(--err);border-color:var(--err)}
  </style></head><body>
  <header>
    <span class="dot"></span><span class="name">Local Agent</span>
    <span class="model">Qwen3.6-35B</span><span class="sp"></span>
    <button class="hbtn" id="procBtn" title="사고 과정 보기/숨기기">💭</button>
    <button class="hbtn" id="newBtn" title="새 대화">＋</button>
    <button class="hbtn" id="listBtn" title="대화 기록">☰</button>
  </header>
  <div id="log"></div>
  <div class="files" id="files"></div>
  <div id="list">
    <div class="lh">대화 기록<span class="sp"></span><button class="hbtn" id="listClose">닫기</button></div>
    <div class="items" id="items"></div>
  </div>
  <footer>
    <button class="stopbtn" id="stop">■ 중지</button>
    <div class="atts" id="atts"></div>
    <div class="inbox">
      <button class="iconbtn" id="attachBtn" title="파일 첨부">📎</button>
      <textarea id="inp" rows="3" placeholder="무엇이든 시켜보세요 — 예: utils.py에 add(a,b) 추가하고 테스트.  (Enter 전송 · Shift+Enter 줄바꿈)"></textarea>
      <button class="iconbtn send" id="send" title="전송">➤</button>
    </div>
  </footer>
  <script>
    const vs=acquireVsCodeApi(), log=document.getElementById('log'), files=document.getElementById('files'), inp=document.getElementById('inp');
    const listEl=document.getElementById('list'), items=document.getElementById('items'), atts=document.getElementById('atts');
    let streamEl=null, streamBuf="", genEl=null, timer=null, t0=0, tok=0, obsEl=null, inCode=false, codeEl=null, changed=new Set(), curStep=0, curAction='';

    function el(cls,txt){const d=document.createElement('div');if(cls)d.className=cls;if(txt!=null)d.textContent=txt;log.appendChild(d);log.scrollTop=log.scrollHeight;return d;}
    function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}
    function clearAll(){log.innerHTML='';files.innerHTML='';changed.clear();streamEl=null;streamBuf="";obsEl=null;inCode=false;codeEl=null;}

    function startGen(){t0=Date.now();tok=0;curStep=0;curAction='';obsEl=null;inCode=false;codeEl=null;
      genEl=document.createElement('div');genEl.className='gen';
      genEl.innerHTML='<span class="spin"></span><span>작업 중…</span><span class="el"></span>';log.appendChild(genEl);
      timer=setInterval(()=>{const s=((Date.now()-t0)/1000).toFixed(1);genEl.querySelector('.el').textContent=(curStep?'단계 '+curStep+' · ':'')+(curAction?curAction+' · ':'')+s+'s · '+tok+' tok';},100);
    }
    function stopGen(){if(timer)clearInterval(timer);timer=null;if(genEl){genEl.remove();genEl=null;}finishStream();}
    // 생성 중엔 실시간 사고를 보여주고(proc 아님), 완료되면 finishStream이 제거 → 답변만 남음
    function appendStream(t){tok++;if(!streamEl){streamEl=document.createElement('div');streamEl.className='stream';streamEl.innerHTML='<span class="tx"></span><span class="cursor"></span>';log.insertBefore(streamEl,genEl);}streamBuf+=t;streamEl.querySelector('.tx').textContent=streamBuf;log.scrollTop=log.scrollHeight;}
    // 스트리밍은 생성 중 실시간 표시만. 완료되면 임시 요소만 제거(재렌더 X) — 최종 구조화는 codeact가 보내는 라인이 담당(중복 방지)
    function finishStream(){if(streamEl){streamEl.remove();streamEl=null;}streamBuf="";}

    function renderLine(line){
      if(/^(--- Step|TASK:|=== RESULT|===\\s*$)/.test(line)){if(/^--- Step/.test(line))el('step-label proc',line.replace(/-/g,'').trim());return;}
      if(line.startsWith('Thought:')){const d=document.createElement('details');d.className='thought proc';d.open=false;
        d.innerHTML='<summary>💭 '+esc(line.slice(8).trim().slice(0,70))+'…</summary><div class="body">'+esc(line.slice(8).trim())+'</div>';log.appendChild(d);log.scrollTop=log.scrollHeight;return;}
      if(line.trim().startsWith('\\\`\\\`\\\`')){inCode=!inCode;if(inCode){const w=document.createElement('div');w.className='code proc';w.innerHTML='<div class="bar"><span class="run">▶</span> 코드 실행<span class="lg">python</span></div>';codeEl=document.createElement('pre');w.appendChild(codeEl);log.appendChild(w);}else codeEl=null;return;}
      if(inCode&&codeEl){codeEl.textContent+=(codeEl.textContent?'\\n':'')+line;log.scrollTop=log.scrollHeight;return;}
      if(line.startsWith('[Observation]')){obsEl=el('obs proc');obsEl.innerHTML='<span class="tag">↳ 결과</span>';obsEl.appendChild(document.createTextNode(line.slice(13).trim()));return;}
      if(line.startsWith('FINAL:')){const f=el('final');f.innerHTML='<span class="ic">✓</span><span class="txt">'+esc(line.slice(6).trim())+'</span>';return;}
      if(/^[▶■]/.test(line)){el('meta proc',line);return;}
      if(line.trim()){if(obsEl)obsEl.appendChild(document.createTextNode('\\n'+line));else el('proc',line);}
    }

    function renderConvList(list){
      items.innerHTML='';
      if(!list.items.length){items.innerHTML='<div class="empty">저장된 대화가 없습니다</div>';return;}
      list.items.forEach(c=>{
        const row=document.createElement('div');row.className='conv'+(c.id===list.currentId?' cur':'');
        const d=new Date(c.ts), ds=(d.getMonth()+1)+'/'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
        row.innerHTML='<div class="t">'+esc(c.title)+'</div><span class="d">'+ds+'</span><span class="x">✕</span>';
        row.querySelector('.t').onclick=()=>{vs.postMessage({type:'select',id:c.id});listEl.classList.remove('on');};
        row.querySelector('.d').onclick=()=>{vs.postMessage({type:'select',id:c.id});listEl.classList.remove('on');};
        row.querySelector('.x').onclick=(e)=>{e.stopPropagation();vs.postMessage({type:'delete',id:c.id});};
        items.appendChild(row);
      });
    }

    function renderAtts(list){
      atts.innerHTML='';
      (list||[]).forEach(name=>{const a=document.createElement('span');a.className='att';
        a.innerHTML='📄 '+esc(name)+' <span class="x">✕</span>';
        a.querySelector('.x').onclick=()=>vs.postMessage({type:'unattach',name});atts.appendChild(a);});
    }

    window.addEventListener('message',e=>{const m=e.data;
      if(m.kind==='gen_start'){startGen();document.getElementById('stop').classList.add('on');}
      else if(m.kind==='event'){if(m.ev.t==='tok')appendStream(m.ev.d);else if(m.ev.t==='step')curStep=m.ev.n;else if(m.ev.t==='action')curAction=m.ev.d;else if(m.ev.t==='gen_done')finishStream();}
      else if(m.kind==='line')renderLine(m.text);
      else if(m.kind==='file'){if(!changed.has(m.text)){changed.add(m.text);const c=document.createElement('span');c.className='chip';c.innerHTML='<span class="b">편집</span>📄 '+esc(m.text);c.onclick=()=>vs.postMessage({type:'open',path:m.text});files.appendChild(c);}}
      else if(m.kind==='meta')el('meta',m.text);
      else if(m.kind==='gen_end'){stopGen();if(m.text)el('meta','■ '+m.text);}
      else if(m.kind==='cleared')clearAll();
      else if(m.kind==='restore'){clearAll();(m.turns||[]).forEach(t=>{if(t.role==='나'){const u=document.createElement('div');u.className='user';u.textContent=t.text;log.appendChild(u);}else{el('ai',t.text);}});log.scrollTop=log.scrollHeight;}
      else if(m.kind==='list')renderConvList(m);
      else if(m.kind==='attach')renderAtts(m.items);
    });

    function send(){const t=inp.value.trim();if(!t)return;const u=document.createElement('div');u.className='user';u.textContent=t;log.appendChild(u);log.scrollTop=log.scrollHeight;inp.value='';vs.postMessage({type:'ask',text:t});}
    document.getElementById('send').onclick=send;
    document.getElementById('stop').onclick=()=>vs.postMessage({type:'stop'});
    document.getElementById('procBtn').onclick=(e)=>{const on=document.body.classList.toggle('showproc');e.currentTarget.classList.toggle('on',on);};
    document.getElementById('newBtn').onclick=()=>vs.postMessage({type:'new'});
    document.getElementById('attachBtn').onclick=()=>vs.postMessage({type:'attach'});
    document.getElementById('listBtn').onclick=()=>{listEl.classList.add('on');vs.postMessage({type:'list'});};
    document.getElementById('listClose').onclick=()=>listEl.classList.remove('on');
    inp.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}});
    // 드래그 앤 드롭 파일 첨부
    ['dragenter','dragover'].forEach(ev=>document.body.addEventListener(ev,e=>{e.preventDefault();e.stopPropagation();document.body.classList.add('drag');}));
    document.body.addEventListener('dragleave',e=>{if(!e.relatedTarget)document.body.classList.remove('drag');});
    document.body.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();document.body.classList.remove('drag');
      const d=e.dataTransfer, u=d.getData('text/uri-list')||d.getData('text/plain')||'';
      const paths=u.split(/\\r?\\n/).map(s=>s.trim()).filter(s=>s&&!s.startsWith('#'));
      if(paths.length)vs.postMessage({type:'attachPath',paths});});
  </script></body></html>`;
}

module.exports = { activate, deactivate() {} };
