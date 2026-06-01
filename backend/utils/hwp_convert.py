"""
HWP / HWPX → PDF 변환 (LibreOffice headless).

순수 Python만으로는 한글 문서를 안정적으로 PDF로 바꾸기 어렵기 때문에,
서버에 LibreOffice(또는 동일 soffice)가 있어야 합니다.

환경 변수 (선택):
  SOFFICE_PATH 또는 LIBREOFFICE_PATH  → soffice / soffice.exe 전체 경로
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import logging
import zipfile
from pathlib import Path
from xml.etree import ElementTree
from typing import List, Optional

logger = logging.getLogger(__name__)


class HwpConversionError(Exception):
    """LibreOffice 변환 실패."""


def find_soffice() -> Optional[str]:
    """
    PATH·SOFFICE_PATH·Windows 기본/버전별 설치 경로에서 soffice 검색.
    (LibreOffice 7/24 등 폴더명이 'LibreOffice 24.8' 처럼 버전이 붙은 경우 대응)
    """
    for env in ("SOFFICE_PATH", "LIBREOFFICE_PATH"):
        raw = (os.environ.get(env) or "").strip()
        if not raw:
            continue
        p = raw.strip('"').strip("'")
        if Path(p).is_file():
            logger.info("soffice: 환경 변수 %s → %s", env, p)
            return p
    for name in ("soffice", "soffice.exe"):
        found = shutil.which(name)
        if found:
            logger.info("soffice: PATH → %s", found)
            return found
    if os.name != "nt":
        return None
    roots: List[Path] = []
    for key in ("ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"):
        v = (os.environ.get(key) or "").strip()
        if v:
            roots.append(Path(v))
    if not roots:
        roots = [Path(r"C:\Program Files"), Path(r"C:\Program Files (x86)")]
    for root in roots:
        if not root.is_dir():
            continue
        for pattern in (
            "LibreOffice*/program/soffice.exe",
            "OpenOffice*/program/soffice.exe",
        ):
            try:
                hits = sorted(root.glob(pattern))
            except OSError:
                continue
            for candidate in hits:
                if candidate.is_file():
                    logger.info("soffice: 자동 탐지 → %s", candidate)
                    return str(candidate)
    for guess in (
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
    ):
        g = Path(guess)
        if g.is_file():
            logger.info("soffice: 자동 탐지(고정 경로) → %s", g)
            return str(g)
    return None


def _run_soffice(
    args: List[str],
    timeout: int,
    *,
    conversion_kind: str = "문서",
) -> None:
    soffice = find_soffice()
    if not soffice:
        raise HwpConversionError(
            "LibreOffice(soffice) 실행 파일을 찾지 못했습니다. "
            "LibreOffice를 설치하거나, 환경 변수 SOFFICE_PATH 또는 LIBREOFFICE_PATH에 "
            "soffice(Windows는 soffice.exe) 전체 경로를 지정하세요."
        )
    try:
        cmd = [soffice, *args]
        run_kw: dict = {
            "check": True,
            "timeout": timeout,
            "capture_output": True,
            "text": True,
        }
        if os.name == "nt":
            run_kw["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        subprocess.run(cmd, **run_kw)
    except subprocess.TimeoutExpired as e:
        raise HwpConversionError(f"LibreOffice 변환 시간 초과({timeout}초). 파일이 너무 크거나 응답이 없습니다.") from e
    except subprocess.CalledProcessError as e:
        err = (e.stderr or e.stdout or "")[:2000]
        logger.warning("soffice failed: %s", err)
        raise HwpConversionError(
            f"LibreOffice로 {conversion_kind}→PDF 변환에 실패했습니다. "
            "파일 형식, 손상, 또는 필터 미지원일 수 있습니다. "
            f"상세: {err or e}"
        ) from e


def convert_hwp_to_pdf(
    hwp_path: Path,
    out_pdf: Path,
    *,
    timeout: int = 180,
) -> None:
    """
    hwp_path → out_pdf (단일 PDF) 생성. out_pdf 부모는 존재해야 함.
    """
    hwp_path = hwp_path.resolve()
    if not hwp_path.is_file():
        raise HwpConversionError(f"입력 파일이 없습니다: {hwp_path}")

    out_pdf = out_pdf.resolve()
    out_pdf.parent.mkdir(parents=True, exist_ok=True)
    if out_pdf.exists():
        try:
            out_pdf.unlink()
        except OSError:
            pass

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        _run_soffice(
            [
                "--headless",
                "--convert-to",
                "pdf",
                "--outdir",
                str(tmp_dir),
                str(hwp_path),
            ],
            timeout=timeout,
            conversion_kind="HWP(한글)",
        )
        # 출력 파일명: 보통 입력과 같은 stem + .pdf
        expected = tmp_dir / f"{hwp_path.stem}.pdf"
        if expected.is_file():
            shutil.copy2(expected, out_pdf)
            logger.info("HWP→PDF ok: %s -> %s", hwp_path, out_pdf)
            return
        pdfs = sorted(tmp_dir.glob("*.pdf"))
        if len(pdfs) == 1:
            shutil.copy2(pdfs[0], out_pdf)
            logger.info("HWP→PDF ok (first pdf): %s -> %s", hwp_path, out_pdf)
            return
        raise HwpConversionError("LibreOffice가 PDF를 생성하지 않았습니다.")


def convert_office_to_pdf(
    office_path: Path,
    out_pdf: Path,
    *,
    timeout: int = 180,
) -> None:
    """
    MS Office 계열(.doc, .docx, .xls, .xlsx, .ppt, .pptx) → PDF (LibreOffice headless).
    Tika 없이 OCR 경로로 넘길 때 사용한다.
    """
    office_path = office_path.resolve()
    if not office_path.is_file():
        raise HwpConversionError(f"입력 파일이 없습니다: {office_path}")

    out_pdf = out_pdf.resolve()
    out_pdf.parent.mkdir(parents=True, exist_ok=True)
    if out_pdf.exists():
        try:
            out_pdf.unlink()
        except OSError:
            pass

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        _run_soffice(
            [
                "--headless",
                "--convert-to",
                "pdf",
                "--outdir",
                str(tmp_dir),
                str(office_path),
            ],
            timeout=timeout,
            conversion_kind="Office",
        )
        expected = tmp_dir / f"{office_path.stem}.pdf"
        if expected.is_file():
            shutil.copy2(expected, out_pdf)
            logger.info("Office→PDF ok: %s -> %s", office_path, out_pdf)
            return
        pdfs = sorted(tmp_dir.glob("*.pdf"))
        if len(pdfs) == 1:
            shutil.copy2(pdfs[0], out_pdf)
            logger.info("Office→PDF ok (first pdf): %s -> %s", office_path, out_pdf)
            return
        raise HwpConversionError("LibreOffice가 Office 파일에서 PDF를 생성하지 않았습니다.")


def extract_docx_text(docx_path: Path) -> str:
    """Extract readable text from a DOCX file without LibreOffice."""
    docx_path = docx_path.resolve()
    if not docx_path.is_file():
        raise HwpConversionError(f"입력 파일이 없습니다: {docx_path}")

    try:
        with zipfile.ZipFile(docx_path) as zf:
            xml_bytes = zf.read("word/document.xml")
    except (KeyError, zipfile.BadZipFile, OSError) as exc:
        raise HwpConversionError(f"DOCX 본문을 읽을 수 없습니다: {exc}") from exc

    try:
        root = ElementTree.fromstring(xml_bytes)
    except ElementTree.ParseError as exc:
        raise HwpConversionError(f"DOCX XML 파싱에 실패했습니다: {exc}") from exc

    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paragraphs: list[str] = []

    for para in root.findall(".//w:p", ns):
        parts: list[str] = []
        for node in para.iter():
            tag = node.tag.rsplit("}", 1)[-1]
            if tag == "t" and node.text:
                parts.append(node.text)
            elif tag == "tab":
                parts.append("\t")
            elif tag in {"br", "cr"}:
                parts.append("\n")
        text = "".join(parts).strip()
        if text:
            paragraphs.append(text)

    return "\n\n".join(paragraphs).strip()


def convert_docx_to_text_pdf(docx_path: Path, out_pdf: Path) -> None:
    """DOCX fallback: render extracted text to PDF when LibreOffice is unavailable."""
    text = extract_docx_text(docx_path)
    if not text:
        raise HwpConversionError("DOCX에서 추출할 텍스트를 찾지 못했습니다.")

    from utils.text_to_pdf import convert_plain_page_texts_to_pdf

    convert_plain_page_texts_to_pdf([text], out_pdf)
    logger.info("DOCX text fallback PDF ok: %s -> %s", docx_path, out_pdf)
