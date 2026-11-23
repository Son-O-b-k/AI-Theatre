// Source material: the text of a document a lesson is taught from. Only the text is kept, and only
// for the request: the job sends it to the model with each call, and nothing is stored.

import mammoth from 'mammoth'
import { extractText, getDocumentProxy } from 'unpdf'
import { MAX_SOURCE_CHARS, type SourceText } from '../shared/protocol'

export const MAX_SOURCE_BYTES = 10 * 1024 * 1024

export class SourceError extends Error {}

type Format = 'pdf' | 'docx' | 'text'

const FORMATS: Record<string, Format> = { pdf: 'pdf', docx: 'docx', txt: 'text', md: 'text', markdown: 'text', csv: 'text' }

export const formatOf = (name: string): Format | undefined => FORMATS[name.toLowerCase().split('.').pop() ?? '']

async function rawText(format: Format, data: Uint8Array): Promise<string> {
  if (format === 'pdf') {
    const pdf = await getDocumentProxy(data)
    const { text } = await extractText(pdf, { mergePages: true })
    return text
  }
  if (format === 'docx') return (await mammoth.extractRawText({ buffer: Buffer.from(data) })).value
  return new TextDecoder().decode(data)
}

/** Tidies extracted text: no runs of spaces or blank lines, which cost tokens and say nothing. */
export function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Cuts text to the limit, at a paragraph or sentence end when one is near. */
export function capped(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_SOURCE_CHARS) return { text, truncated: false }
  const cut = text.slice(0, MAX_SOURCE_CHARS)
  const end = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '))
  return { text: (end > MAX_SOURCE_CHARS * 0.8 ? cut.slice(0, end + 1) : cut).trim(), truncated: true }
}

export const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length

export async function sourceText(name: string, data: Uint8Array): Promise<SourceText> {
  const format = formatOf(name)
  if (!format) throw new SourceError('Use a PDF, Word (.docx) or text file.')
  if (data.byteLength > MAX_SOURCE_BYTES) throw new SourceError('The file must be under 10 MB.')
  let text: string
  try {
    text = tidy(await rawText(format, data))
  } catch {
    throw new SourceError(`Could not read ${name}. Is it a ${format === 'text' ? 'text' : format.toUpperCase()} file?`)
  }
  if (!text) {
    throw new SourceError(format === 'pdf' ? 'This PDF has no text to read; it may be scanned pages. Try a PDF with selectable text.' : `${name} has no text.`)
  }
  const { text: kept, truncated } = capped(text)
  return { name, text: kept, words: countWords(kept), truncated }
}
