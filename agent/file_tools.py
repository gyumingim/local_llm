"""여러 형식 파일 읽기·만들기 도구 — 에이전트(codeact_agent)와 웹 백엔드(미리보기)가 같이 씀.

읽기  read_file(path)       : txt/md/csv/tsv/json/코드, pdf, docx, pptx, xlsx/xls, hwp/hwpx → 글
미리보기 preview(path)      : 웹 결과물 창용 {kind: table|text|pdf|image}
만들기 make_pdf(path, text) : 한글 글꼴로 PDF 만들기
그 밖의 형식 쓰기·고치기는 라이브러리를 직접 씀 (codeact_agent 의 프롬프트에 사용법)
필요 패키지: pandas openpyxl pypdf pymupdf python-docx python-pptx python-hwpx
"""
import json
import os
import warnings

TEXT_EXT = {".txt", ".md", ".py", ".js", ".ts", ".html", ".css", ".json", ".log", ".xml", ".yaml", ".yml", ".ini", ".cfg", ".sh", ".bat", ".ps1", ".sql"}
TABLE_EXT = {".csv", ".tsv", ".xlsx", ".xls"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}


def _ext(path):
    return os.path.splitext(path)[1].lower()


def _read_text(path):
    for enc in ("utf-8-sig", "cp949", "latin-1"):  # 한국 윈도우에서 만든 파일은 cp949 인 경우가 많음
        try:
            with open(path, encoding=enc) as fh:
                return fh.read()
        except UnicodeDecodeError:
            continue
    return ""


def _tables(path, max_rows=200):
    """csv/tsv/xlsx → [(시트 이름, DataFrame)]"""
    import pandas as pd
    ext = _ext(path)
    if ext in (".csv", ".tsv"):
        sep = "\t" if ext == ".tsv" else ","
        for enc in ("utf-8-sig", "cp949"):
            try:
                return [(os.path.basename(path), pd.read_csv(path, sep=sep, encoding=enc, nrows=max_rows))]
            except UnicodeDecodeError:
                continue
    sheets = pd.read_excel(path, sheet_name=None, nrows=max_rows)
    return list(sheets.items())


def _docx_text(path):
    import docx
    d = docx.Document(path)
    parts = [p.text for p in d.paragraphs if p.text.strip()]
    for ti, t in enumerate(d.tables, 1):
        parts.append(f"\n[표 {ti}]")
        parts += [" | ".join(c.text.strip() for c in row.cells) for row in t.rows]
    return "\n".join(parts)


def _pptx_text(path):
    from pptx import Presentation
    out = []
    for i, slide in enumerate(Presentation(path).slides, 1):
        out.append(f"--- 슬라이드 {i} ---")
        for sh in slide.shapes:
            if sh.has_text_frame and sh.text_frame.text.strip():
                out.append(sh.text_frame.text)
            if getattr(sh, "has_table", False) and sh.has_table:
                out += [" | ".join(c.text for c in r.cells) for r in sh.table.rows]
    return "\n".join(out)


def _pdf_text(path):
    try:
        import fitz
        with fitz.open(path) as doc:
            return "\n".join(f"--- {i} 쪽 ---\n{p.get_text()}" for i, p in enumerate(doc, 1))
    except ImportError:
        from pypdf import PdfReader
        return "\n".join(f"--- {i} 쪽 ---\n{p.extract_text() or ''}" for i, p in enumerate(PdfReader(path).pages, 1))


def _hwp_text(path):
    """한글 .hwp(5.x)·.hwpx 모두 python-hwpx 로 읽음"""
    from hwpx import HwpxDocument
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        doc = HwpxDocument.open(path)
        plain = doc.text.plain
        return plain() if callable(plain) else plain


def read_file(path, max_chars=12000):
    """어떤 형식이든 사람이 읽을 글로 (너무 길면 앞부분만)."""
    if not os.path.isfile(path):
        return f"read_file error: 파일 없음 — {path}"
    ext = _ext(path)
    try:
        if ext in IMAGE_EXT:
            return "이미지 파일입니다 — see_image(path, question) 로 읽으세요."
        if ext in TABLE_EXT:
            out = []
            for name, df in _tables(path):
                out.append(f"[시트 {name}] {df.shape[0]}행 × {df.shape[1]}열 (최대 200행만 읽음)\n{df.to_string(max_rows=60, max_cols=30)}")
            text = "\n\n".join(out)
        elif ext == ".pdf":
            text = _pdf_text(path)
        elif ext == ".docx":
            text = _docx_text(path)
        elif ext == ".pptx":
            text = _pptx_text(path)
        elif ext in (".hwp", ".hwpx"):
            text = _hwp_text(path)
        elif ext == ".doc":
            return "read_file error: 옛 Word(.doc)는 못 읽습니다 — Word 에서 .docx 로 저장해 다시 올려 주세요."
        else:
            text = _read_text(path)
    except Exception as e:
        return f"read_file error ({ext}): {type(e).__name__}: {e}"
    if len(text) > max_chars:
        text = text[:max_chars] + f"\n…(앞 {max_chars}자만 — 전체 {len(text)}자)"
    return text


def preview(path):
    """웹 결과물 창 미리보기용"""
    ext = _ext(path)
    if ext == ".pdf":
        return {"kind": "pdf"}
    if ext in IMAGE_EXT:
        return {"kind": "image"}
    if ext in TABLE_EXT:
        try:
            sheets = []
            for name, df in _tables(path):
                df = df.fillna("")
                sheets.append({"name": str(name), "columns": [str(c) for c in df.columns],
                               "rows": [[str(v) for v in r] for r in df.head(200).values.tolist()]})
            return {"kind": "table", "sheets": sheets}
        except Exception as e:
            return {"kind": "text", "text": f"미리보기 실패: {e}"}
    return {"kind": "text", "text": read_file(path, max_chars=60000)}


def _korean_font():
    for f in (r"C:\Windows\Fonts\malgun.ttf", "/System/Library/Fonts/AppleSDGothicNeo.ttc",
              "/usr/share/fonts/truetype/nanum/NanumGothic.ttf", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"):
        if os.path.exists(f):
            return f
    return None


def make_pdf(path, text, title=None, font_size=11):
    """한글이 깨지지 않는 PDF 만들기 (A4, 자동 줄바꿈·쪽 나눔). 표·그림이 필요하면 docx 로 만든 뒤 변환하는 게 낫다."""
    import fitz
    fontfile = _korean_font()
    font = fitz.Font(fontfile=fontfile) if fontfile else fitz.Font("helv")
    W, H, M = 595, 842, 56  # A4 (pt), 여백

    def wrap(line, size):
        out, cur = [], ""
        for ch in line:
            if font.text_length(cur + ch, fontsize=size) > W - 2 * M:
                out.append(cur)
                cur = ch
            else:
                cur += ch
        return out + [cur]

    rows = []
    if title:
        rows += [(r, font_size + 6) for r in wrap(title, font_size + 6)] + [("", font_size)]
    for line in str(text).splitlines() or [""]:
        rows += [(r, font_size) for r in wrap(line, font_size)]
    doc = fitz.open()
    page, y = None, H
    for r, size in rows:
        step = size * 1.6
        if page is None or y + step > H - M:
            page, y = doc.new_page(width=W, height=H), M
            if fontfile:
                page.insert_font(fontname="kr", fontfile=fontfile)
        y += step
        page.insert_text((M, y), r, fontsize=size, fontname="kr" if fontfile else "helv")
    pages = len(doc)
    doc.save(path)
    doc.close()
    return f"PDF 저장: {path} ({pages}쪽)"
