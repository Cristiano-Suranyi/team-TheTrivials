"""Compose a clean, compact PDF from reviewed text; never embed source content."""
from __future__ import annotations

import html
import io
import re
import unicodedata


def compact(text):
    return ''.join(c for c in unicodedata.normalize('NFKC', text) if not c.isspace())


def render_review_text(review_lines):
    """One marker per selected word, compact horizontal spaces, retain line order."""
    lines = []
    for line in review_lines:
        text = ''.join(re.sub(r'\S+', '*', s.text) if s.masked else s.text for s in line)
        text = re.sub(r'[^\S\n]+', ' ', text).strip()
        if text:
            lines.append(text)
    return '\n'.join(lines) + ('\n' if lines else '')


def redact_pdf(pdf_bytes, original_lines, review_lines):
    """Validate source identity/text, then compose only the reviewed output on A4."""
    import pymupdf
    try:
        original = pymupdf.open(stream=pdf_bytes, filetype='pdf')
    except Exception:
        raise ValueError('Invalid PDF. Select the original document again.') from None
    with original:
        if original.needs_pass:
            raise ValueError('Password-protected PDFs are not supported.')
        expected = compact('\n'.join(original_lines))
        extracted = compact('\n'.join(page.get_text(sort=True) for page in original))
        if not expected or extracted != expected:
            raise ValueError('The PDF text does not match this review. Select the exact original PDF; no PDF was exported.')
    if [''.join(s.text for s in line) for line in review_lines] != original_lines:
        raise ValueError('Review text does not match the original document.')
    text = render_review_text(review_lines)
    # Story supplies embedded fonts and handles Unicode, wrapping and page breaks.
    markup = '<body>' + ''.join('<p>' + html.escape(line) + '</p>' for line in text.splitlines()) + '</body>'
    story = pymupdf.Story(html=markup, user_css='body { font-family: sans-serif; font-size: 11pt; margin: 0; } p { margin: 0; line-height: 1.4; overflow-wrap: anywhere; }')
    page = pymupdf.Rect(0, 0, 595.276, 841.89)
    content = pymupdf.Rect(40, 40, page.width - 40, page.height - 40)
    stream = io.BytesIO()
    writer = pymupdf.DocumentWriter(stream)
    try:
        story.write(writer, lambda number, filled: (page, content, None))
    finally:
        writer.close()
    return stream.getvalue()
