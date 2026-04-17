"""Download the NASA ISS Reference Guide PDF, extract text, and split into
markdown chapter files inside server/corpus/.

The Reference Guide is a public-domain NASA JSC publication.

Usage:
    server/.venv/bin/python server/scripts/pull_iss_reference.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import httpx
import pypdf

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "corpus_raw"
CORPUS_DIR = ROOT / "corpus"
RAW_DIR.mkdir(exist_ok=True)
CORPUS_DIR.mkdir(exist_ok=True)

PDF_URL = "https://www.nasa.gov/wp-content/uploads/2017/09/np-2015-05-022-jsc-iss-guide-2015-update-111015-508c.pdf"
PDF_PATH = RAW_DIR / "iss-reference-guide.pdf"


def download_pdf() -> Path:
    if PDF_PATH.exists() and PDF_PATH.stat().st_size > 100_000:
        print(f"[skip] using cached {PDF_PATH} ({PDF_PATH.stat().st_size} bytes)")
        return PDF_PATH
    print(f"downloading {PDF_URL}")
    with httpx.Client(follow_redirects=True, timeout=60.0) as c:
        r = c.get(PDF_URL)
        r.raise_for_status()
        PDF_PATH.write_bytes(r.content)
    print(f"saved {PDF_PATH} ({PDF_PATH.stat().st_size} bytes)")
    return PDF_PATH


def extract_pages(pdf_path: Path) -> list[str]:
    reader = pypdf.PdfReader(str(pdf_path))
    pages = []
    for i, page in enumerate(reader.pages):
        try:
            text = page.extract_text() or ""
        except Exception as e:  # noqa: BLE001
            print(f"  warn: page {i} extract failed: {e}")
            text = ""
        pages.append(text)
    print(f"extracted {len(pages)} pages")
    return pages


def slugify(title: str) -> str:
    s = re.sub(r"[^\w\s-]", "", title.lower())
    s = re.sub(r"[\s_-]+", "-", s).strip("-")
    return s[:60] or "section"


CHAPTER_HEADING = re.compile(
    r"^(?P<title>[A-Z][A-Z0-9 \-&:,'/]{4,80})\s*$",
    re.MULTILINE,
)


def split_by_chapter(pages: list[str]) -> list[tuple[str, str]]:
    """Split the full text into (title, body) sections by detecting ALL-CAPS
    headings on their own line. This is rough but works for NASA PDFs."""
    full = "\n".join(pages)
    # Normalize whitespace
    full = re.sub(r"\r\n?", "\n", full)
    full = re.sub(r"[ \t]+", " ", full)

    # Find chapter-like headings
    headings: list[tuple[int, str]] = []
    for m in CHAPTER_HEADING.finditer(full):
        title = m.group("title").strip()
        # Filter out noise: page numbers, short words, common PDF garbage.
        if len(title.split()) < 2:
            continue
        if any(
            junk in title
            for junk in (
                "NASA", "NP-", "JSC-", "508C", "REFERENCE GUIDE",
                "INTERNATIONAL SPACE STATION",
            )
        ):
            # Keep some, drop running-header noise
            if title.startswith(("REFERENCE", "INTERNATIONAL", "NP-", "JSC-")):
                continue
        headings.append((m.start(), title))

    # Deduplicate adjacent headings
    dedup: list[tuple[int, str]] = []
    for idx, title in headings:
        if dedup and dedup[-1][1] == title:
            continue
        dedup.append((idx, title))
    headings = dedup

    print(f"found {len(headings)} candidate chapter headings")

    if not headings:
        return [("full-text", full)]

    sections: list[tuple[str, str]] = []
    for i, (start, title) in enumerate(headings):
        end = headings[i + 1][0] if i + 1 < len(headings) else len(full)
        body = full[start + len(title) : end].strip()
        if len(body) < 500:
            continue  # probably a false positive
        sections.append((title, body))

    print(f"kept {len(sections)} non-trivial sections")
    return sections


def write_section(idx: int, title: str, body: str) -> Path:
    slug = slugify(title)
    name = f"iss-ref-{idx:02d}-{slug}.md"
    out = CORPUS_DIR / name
    content = f"# {title.title()}\n\n_Source: NASA ISS Reference Guide (JSC NP-2015-05-022)_\n\n{body}\n"
    out.write_text(content, encoding="utf-8")
    return out


def main() -> int:
    pdf = download_pdf()
    pages = extract_pages(pdf)
    sections = split_by_chapter(pages)
    if not sections:
        print("no sections produced — aborting", file=sys.stderr)
        return 1
    written = 0
    for i, (title, body) in enumerate(sections, start=1):
        # Trim very long bodies (>60k chars) at a paragraph boundary so each file
        # stays embedable.
        if len(body) > 60_000:
            cut = body.rfind("\n\n", 0, 60_000)
            body = body[: cut if cut > 10_000 else 60_000]
        p = write_section(i, title, body)
        written += 1
        print(f"  wrote {p.name} ({len(body)} chars)")
    print(f"done: {written} files in {CORPUS_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
