// Run with `npm test`. Reading the text of documents to teach from.

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { MAX_SOURCE_CHARS } from '../shared/protocol'
import { JobRequestSchema } from './routes/jobs'
import { capped, sourceText, tidy } from './sources'

/** A one-page PDF whose page says `text`, with a correct cross-reference table. */
function pdfSaying(text: string): Uint8Array {
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = objects.map((body, i) => {
    const at = pdf.length
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
    return at
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}

describe('source material', () => {
  test('reads the text of a PDF', async () => {
    const read = await sourceText('notes.pdf', pdfSaying('Plants make sugar from light'))
    assert.equal(read.text, 'Plants make sugar from light')
    assert.equal(read.words, 5)
    assert.equal(read.truncated, false)
  })

  test('reads text files, and tidies the spacing', async () => {
    const read = await sourceText('notes.md', new TextEncoder().encode('# Light\r\n\r\n\r\n\r\nPlants   need\tlight.  \n'))
    assert.equal(read.text, '# Light\n\nPlants need light.')
    assert.equal(tidy(' a \n\n\n\n b '), 'a\n\nb')
  })

  test('refuses other kinds of file, and files that are not what they say', async () => {
    await assert.rejects(sourceText('photo.png', new Uint8Array(4)), /PDF, Word/)
    await assert.rejects(sourceText('notes.pdf', new TextEncoder().encode('not a pdf')), /Could not read notes\.pdf/)
    await assert.rejects(sourceText('notes.docx', new TextEncoder().encode('not a docx')), /Could not read notes\.docx/)
    await assert.rejects(sourceText('empty.txt', new TextEncoder().encode('  \n ')), /has no text/)
  })

  test('long text keeps only its beginning, ending at a paragraph', () => {
    const paragraph = 'word '.repeat(199) + 'end.\n\n'
    const { text, truncated } = capped(paragraph.repeat(30))
    assert.ok(truncated)
    assert.ok(text.length <= MAX_SOURCE_CHARS)
    assert.ok(text.endsWith('end.'))
  })

  test('a lesson request keeps its language and source', () => {
    const parsed = JobRequestSchema.parse({
      mode: 'teach', prompt: 'Photosynthesis', projectId: 'p1', provider: 'default', model: 'm', voice: 'browser',
      language: 'French', source: 'Plants make sugar from light.',
    })
    assert.equal(parsed.language, 'French')
    assert.equal(parsed.source, 'Plants make sugar from light.')
  })
})
