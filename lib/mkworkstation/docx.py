"""Markdown note -> Word document (.docx), with no extra software.

A .docx is a zip of XML files; this writes the few it needs. Supported:
headings, paragraphs, bullet and numbered lists, checklists (☐ / ☑),
quotes and callouts, fenced code, tables, horizontal rules, pictures
(![[name.png]] and ![[name.png|300]], at that width), and inline **bold**,
*italic*, ==highlight==, ~~strike~~, `code`, [[links]] and [text](url).
"""
import re
import zipfile
from xml.sax.saxutils import escape

EMU_PER_PX = 9525
MAX_WIDTH_PX = 600  # A4 text width at 96 dpi, about

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Default Extension="jpeg" ContentType="image/jpeg"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>"""

ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""


def _style(sid, name, size, bold=False, colour=None, space_before=0, font=None, italic=False, indent=0):
    rpr = f'<w:sz w:val="{size}"/>' + ("<w:b/>" if bold else "") + ("<w:i/>" if italic else "") + \
        (f'<w:color w:val="{colour}"/>' if colour else "") + \
        (f'<w:rFonts w:ascii="{font}" w:hAnsi="{font}"/>' if font else "")
    ppr = f'<w:spacing w:before="{space_before}" w:after="120"/>' + (f'<w:ind w:left="{indent}"/>' if indent else "")
    return (f'<w:style w:type="paragraph" w:styleId="{sid}"><w:name w:val="{name}"/><w:basedOn w:val="Normal"/>'
            f'<w:qFormat/><w:pPr>{ppr}</w:pPr><w:rPr>{rpr}</w:rPr></w:style>')


STYLES = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
          '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>'
          '<w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" '
          'w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
          '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
          + _style("Heading1", "heading 1", 36, True, "1F3864", 360)
          + _style("Heading2", "heading 2", 30, True, "2E5395", 280)
          + _style("Heading3", "heading 3", 26, True, "2E5395", 200)
          + _style("Quote", "Quote", 22, italic=True, colour="555555", indent=567)
          + _style("Code", "Code", 19, font="Consolas", indent=284)
          + _style("ListPara", "List Paragraph", 22, indent=567)
          + '<w:style w:type="table" w:styleId="Grid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>'
          + "".join(f'<w:{side} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>'
                    for side in ("top", "left", "bottom", "right", "insideH", "insideV"))
          + '</w:tblBorders></w:tblPr></w:style></w:styles>')

INLINE = re.compile(r"(\*\*[^*]+\*\*|==[^=]+==|~~[^~]+~~|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`"
                    r"|\[\[[^\]]+\]\]|\[[^\]]+\]\([^)]+\))")


def _runs(text):
    """Inline Markdown to Word runs."""
    out = []
    for part in INLINE.split(text):
        if not part:
            continue
        props, body = "", part
        if part.startswith("**") and part.endswith("**"):
            props, body = "<w:b/>", part[2:-2]
        elif part.startswith("==") and part.endswith("=="):
            props, body = '<w:highlight w:val="yellow"/>', part[2:-2]
        elif part.startswith("~~") and part.endswith("~~"):
            props, body = "<w:strike/>", part[2:-2]
        elif (part.startswith("*") and part.endswith("*") and len(part) > 2) or \
                (part.startswith("_") and part.endswith("_") and len(part) > 2):
            props, body = "<w:i/>", part[1:-1]
        elif part.startswith("`") and part.endswith("`"):
            props, body = '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:val="clear" w:fill="F2F2F2"/>', part[1:-1]
        elif part.startswith("[[") and part.endswith("]]"):
            inner = part[2:-2]
            body = inner.split("|", 1)[1] if "|" in inner else inner.split("#")[0]
            props = '<w:color w:val="2E5395"/>'
        elif part.startswith("[") and "](" in part:
            label, url = part[1:].split("](", 1)
            body = f"{label} ({url[:-1]})"
            props = '<w:color w:val="2E5395"/>'
        out.append(f'<w:r><w:rPr>{props}</w:rPr><w:t xml:space="preserve">{escape(body)}</w:t></w:r>')
    return "".join(out)


def _para(text, style=None, runs=None):
    ppr = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    return f"<w:p>{ppr}{runs if runs is not None else _runs(text)}</w:p>"


def _image(rid, name, width_px, height_px, n):
    cx, cy = int(width_px * EMU_PER_PX), int(height_px * EMU_PER_PX)
    return (f'<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
            f'<wp:extent cx="{cx}" cy="{cy}"/><wp:docPr id="{n}" name="{escape(name)}"/>'
            f'<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
            f'<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
            f'<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
            f'<pic:nvPicPr><pic:cNvPr id="{n}" name="{escape(name)}"/><pic:cNvPicPr/></pic:nvPicPr>'
            f'<pic:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
            f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
            f'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>'
            f'</wp:inline></w:drawing></w:r></w:p>')


def _table(rows):
    cells = [[c.strip() for c in r.strip().strip("|").split("|")] for r in rows]
    cells = [r for r in cells if not all(re.fullmatch(r":?-{2,}:?", c) for c in r)]  # drop the --- line
    columns = max((len(r) for r in cells), default=1)
    out = ['<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>',
           "<w:tblGrid>" + f'<w:gridCol w:w="{9600 // columns}"/>' * columns + "</w:tblGrid>"]
    for i, row in enumerate(cells):
        out.append("<w:tr>")
        for cell in row:
            runs = _runs(f"**{cell}**" if i == 0 and cell else cell)
            out.append(f"<w:tc><w:tcPr><w:tcW w:w=\"0\" w:type=\"auto\"/></w:tcPr><w:p>{runs}</w:p></w:tc>")
        out.append("</w:tr>")
    out.append("</w:tbl>")
    return "".join(out)


def write(text, out_path, find_image=lambda name: None, title=None):
    """TEXT (Markdown) to a .docx at OUT_PATH. FIND_IMAGE(name) returns a Path
    for an embedded picture, or None to leave it as text."""
    from PIL import Image

    body, media, rels = [], [], []
    if title:
        body.append(_para(title, "Heading1"))
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if stripped.startswith("```"):
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                body.append(_para("", "Code", f'<w:r><w:t xml:space="preserve">{escape(lines[i])}</w:t></w:r>'))
                i += 1
        elif stripped.startswith("|") and i + 1 < len(lines) and re.match(r"^\s*\|?\s*:?-{2,}", lines[i + 1]):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(lines[i])
                i += 1
            body.append(_table(rows))
            continue
        elif m := re.match(r"^\s*!\[\[([^\]|#]+)(?:\|(\d+))?[^\]]*\]\]\s*$", line):
            path = find_image(m.group(1).strip())
            if path and path.suffix.lower() in (".png", ".jpg", ".jpeg"):
                with Image.open(path) as im:
                    w, h = im.size
                width = min(int(m.group(2)) if m.group(2) else w, MAX_WIDTH_PX, w)
                n = len(media) + 1
                ext = "png" if path.suffix.lower() == ".png" else "jpeg"
                media.append((f"media/image{n}.{ext}", path.read_bytes()))
                rid = f"rIdImg{n}"
                rels.append(f'<Relationship Id="{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
                            f'relationships/image" Target="media/image{n}.{ext}"/>')
                body.append(_image(rid, m.group(1), width, round(width * h / w), n))
            else:
                body.append(_para(f"[{m.group(1)}]"))
        elif m := re.match(r"^(#{1,6})\s+(.*)", stripped):
            body.append(_para(m.group(2), f"Heading{min(3, len(m.group(1)))}"))
        elif re.fullmatch(r"(-{3,}|\*{3,}|_{3,})", stripped):
            body.append('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BFBFBF"/>'
                        '</w:pBdr></w:pPr></w:p>')
        elif m := re.match(r"^(\s*)[-*+]\s+\[( |x|X)\]\s+(.*)", line):
            box = "☑ " if m.group(2).lower() == "x" else "☐ "
            body.append(_para("", "ListPara", f'<w:r><w:t xml:space="preserve">{box}</w:t></w:r>' + _runs(m.group(3))))
        elif m := re.match(r"^(\s*)[-*+]\s+(.*)", line):
            body.append(_para("", "ListPara", '<w:r><w:t xml:space="preserve">•  </w:t></w:r>' + _runs(m.group(2))))
        elif m := re.match(r"^(\s*)(\d+)[.)]\s+(.*)", line):
            body.append(_para("", "ListPara", f'<w:r><w:t xml:space="preserve">{m.group(2)}.  </w:t></w:r>'
                              + _runs(m.group(3))))
        elif stripped.startswith(">"):
            quote = stripped.lstrip("> ").strip()
            if cm := re.match(r"\[!(\w+)\][+-]?\s*(.*)", quote):
                body.append(_para("", "Quote", f'<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">'
                                  f'{escape(cm.group(1).title())}: </w:t></w:r>' + _runs(cm.group(2))))
            else:
                body.append(_para(quote, "Quote"))
        elif stripped:
            body.append(_para(stripped))
        i += 1

    document = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
                'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
                'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">'
                '<w:body>' + "".join(body) +
                '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" '
                'w:left="1134" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>')
    doc_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
                'relationships/styles" Target="styles.xml"/>' + "".join(rels) + '</Relationships>')
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        z.writestr("_rels/.rels", ROOT_RELS)
        z.writestr("word/document.xml", document)
        z.writestr("word/styles.xml", STYLES)
        z.writestr("word/_rels/document.xml.rels", doc_rels)
        for name, data in media:
            z.writestr(f"word/{name}", data)
