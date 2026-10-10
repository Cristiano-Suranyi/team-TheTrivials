import unittest
import pymupdf
from submission.pdf_export import redact_pdf, render_review_text, compact
from submission.web_api import Segment

class PDFExportTests(unittest.TestCase):
    def document(self, text):
        doc = pymupdf.open()
        doc.new_page().insert_text((72, 72), text)
        content = doc.tobytes()
        doc.close()
        return content

    def test_repeated_word_only_selected_occurrence_is_removed(self):
        pdf = self.document('Ana viu Ana.')
        review = [[Segment(text='Ana viu ', masked=False), Segment(text='Ana', masked=True), Segment(text='.', masked=False)]]
        result = redact_pdf(pdf, ['Ana viu Ana.'], review)
        with pymupdf.open(stream=result, filetype='pdf') as doc:
            self.assertEqual(doc[0].get_text().count('Ana'), 1)
            self.assertIn('viu', doc[0].get_text())

    def test_wrong_document_and_modified_review_are_rejected(self):
        pdf = self.document('Ana viu Ana.')
        with self.assertRaises(ValueError):
            redact_pdf(pdf, ['Outro texto'], [[Segment(text='Outro texto', masked=True)]])
        with self.assertRaises(ValueError):
            redact_pdf(pdf, ['Ana viu Ana.'], [[Segment(text='Alterado', masked=True)]])

    def test_whitespace_reconciliation_and_partial_manual_selection(self):
        pdf = self.document('Nome: Ana Correia')
        result = redact_pdf(pdf, ['Nome: Ana  Correia'], [[Segment(text='Nome: ',masked=False),Segment(text='Ana ',masked=True),Segment(text=' Correia',masked=False)]])
        with pymupdf.open(stream=result,filetype='pdf') as doc:
            text=doc[0].get_text()
            self.assertNotIn('Ana',text)
            self.assertIn('Correia',text)
            self.assertIn('Nome:',text)

    def test_compact_unicode_and_html_are_plain_text(self):
        original = "Nome: Ána   Correia <b>ação</b>"
        review = [[Segment(text="Nome: ",masked=False),Segment(text="Ána   Correia",masked=True),Segment(text=" <b>ação</b>",masked=False)]]
        result=redact_pdf(self.document(original),[original],review)
        with pymupdf.open(stream=result,filetype="pdf") as doc:
            self.assertEqual(compact(doc[0].get_text()),compact(render_review_text(review)))
            self.assertIn("Nome: * * <b>ação</b>",doc[0].get_text())
            words=doc[0].get_text("words")
            stars=[word for word in words if word[4]=="*"]
            self.assertLess(stars[1][0]-stars[0][0],15)

    def test_long_document_reflows_without_clipping_or_missing_text(self):
        source=pymupdf.open(); original=[]; review=[]
        for page_number in range(8):
            page=source.new_page()
            for i in range(40):
                number=page_number*40+i
                line=f"Linha {number}: Informação pública, ação e descrição de exemplo. Ana"
                page.insert_text((40,50+i*16),line,fontsize=11)
                original.append(line)
                review.append([Segment(text=line[:-3],masked=False),Segment(text="Ana",masked=True)])
        result=redact_pdf(source.tobytes(),original,review);source.close()
        with pymupdf.open(stream=result,filetype="pdf") as doc:
            self.assertGreater(len(doc),1)
            self.assertEqual(compact(''.join(p.get_text() for p in doc)),compact(render_review_text(review)))
            self.assertNotIn("Ana",''.join(p.get_text() for p in doc))
            for page in doc:
                self.assertAlmostEqual(page.rect.width,595.276,places=2)
                for word in page.get_text("words"):
                    self.assertGreaterEqual(word[0],39)
                    self.assertLessEqual(word[2],page.rect.width-39)
                    self.assertGreaterEqual(word[1],39)
                    self.assertLessEqual(word[3],page.rect.height-39)
