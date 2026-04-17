"""Pull a focused set of NASA Technical Reports Server (NTRS) papers
relevant to ISS operations, ECLSS, and thermal control.

NTRS has a public JSON citations API at https://ntrs.nasa.gov/api/citations/search
and per-paper PDF links that don't require auth for unclassified material.

Usage:
    server/.venv/bin/python server/scripts/pull_ntrs.py
"""

from __future__ import annotations

import re
import sys
import time
from pathlib import Path

import httpx
import pypdf

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "corpus_raw" / "ntrs"
CORPUS_DIR = ROOT / "corpus"
RAW_DIR.mkdir(parents=True, exist_ok=True)
CORPUS_DIR.mkdir(exist_ok=True)

QUERIES = [
    ("ISS ECLSS life support", 8),
    ("ISS ATCS ammonia thermal", 8),
    ("ISS CDRA CO2 removal", 5),
    ("ISS water recovery WPA UPA", 5),
    ("ISS anomaly rapid depressurization", 4),
    ("ISS micrometeoroid orbital debris shield", 4),
]

CITATIONS_API = "https://ntrs.nasa.gov/api/citations/search"
MIN_PAGES = 2
MAX_PAGES = 80  # skip giant handbooks; they extract poorly


def slugify(s: str) -> str:
    s = re.sub(r"[^\w\s-]", "", s.lower())
    s = re.sub(r"[\s_-]+", "-", s).strip("-")
    return s[:70] or "ntrs"


def search(query: str, rows: int) -> list[dict]:
    params = {"q": query, "page.size": rows, "page.from": 0}
    with httpx.Client(timeout=30.0, follow_redirects=True) as c:
        r = c.get(CITATIONS_API, params=params, headers={"Accept": "application/json"})
        r.raise_for_status()
        data = r.json()
    return data.get("results", [])


def pick_pdf_url(citation: dict) -> str | None:
    """NTRS citations expose downloads under 'downloads' list. Pick the first
    PDF. URLs are relative to ntrs.nasa.gov — make absolute."""
    for d in citation.get("downloads", []) or []:
        link = d.get("links", {}).get("original") or d.get("links", {}).get("pdf")
        if link and link.lower().endswith(".pdf"):
            if link.startswith("/"):
                link = "https://ntrs.nasa.gov" + link
            return link
    # Fallback: some papers have a "id" we can construct a URL from
    return None


def download(url: str, out: Path) -> bool:
    if out.exists() and out.stat().st_size > 20_000:
        return True
    try:
        with httpx.Client(timeout=60.0, follow_redirects=True) as c:
            r = c.get(url)
            if r.status_code != 200 or not r.content.startswith(b"%PDF"):
                print(f"    skip (status {r.status_code}, not a PDF)")
                return False
            out.write_bytes(r.content)
        return True
    except Exception as e:  # noqa: BLE001
        print(f"    download failed: {e}")
        return False


def extract_text(pdf: Path) -> tuple[str, int] | None:
    try:
        reader = pypdf.PdfReader(str(pdf))
    except Exception as e:  # noqa: BLE001
        print(f"    pdf open failed: {e}")
        return None
    n = len(reader.pages)
    if n < MIN_PAGES or n > MAX_PAGES:
        return None
    parts: list[str] = []
    for p in reader.pages:
        try:
            parts.append(p.extract_text() or "")
        except Exception:
            pass
    text = "\n".join(parts)
    text = re.sub(r"\s+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    if len(text) < 1500:
        return None
    return text, n


def write_markdown(cit: dict, text: str, idx: int) -> Path | None:
    title = (cit.get("title") or "").strip() or "Untitled"
    authors = ", ".join(a.get("name", "") for a in cit.get("authorAffiliations", [])[:4]) or "NASA"
    doc_id = cit.get("id") or idx
    slug = slugify(title)
    out = CORPUS_DIR / f"ntrs-{doc_id}-{slug}.md"
    header = (
        f"# {title}\n\n"
        f"_Source: NASA Technical Reports Server ({doc_id}). Authors: {authors}._\n\n"
    )
    # Clip extremely long papers; keep first ~40k chars
    if len(text) > 45_000:
        cut = text.rfind("\n\n", 0, 45_000)
        text = text[: cut if cut > 10_000 else 45_000]
    out.write_text(header + text + "\n", encoding="utf-8")
    return out


def main() -> int:
    seen: set[str] = set()
    total = 0
    for q, n in QUERIES:
        print(f"\nquery: {q!r} (top {n})")
        try:
            results = search(q, n)
        except Exception as e:  # noqa: BLE001
            print(f"  search error: {e}")
            continue
        for cit in results:
            doc_id = str(cit.get("id") or "")
            if not doc_id or doc_id in seen:
                continue
            seen.add(doc_id)
            url = pick_pdf_url(cit)
            if not url:
                continue
            title = (cit.get("title") or "")[:80]
            print(f"  {doc_id} {title!r}")
            pdf_path = RAW_DIR / f"{doc_id}.pdf"
            if not download(url, pdf_path):
                continue
            extracted = extract_text(pdf_path)
            if not extracted:
                print("    skip (bad extract or out-of-range)")
                continue
            text, pages = extracted
            out = write_markdown(cit, text, total)
            total += 1
            print(f"    -> {out.name if out else '(write failed)'}  [{pages} pages]")
            time.sleep(0.2)
    print(f"\ndone: {total} NTRS papers written")
    return 0


if __name__ == "__main__":
    sys.exit(main())
