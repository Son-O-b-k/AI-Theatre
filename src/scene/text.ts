// Text measured without a browser (layout runs on the server too): an average glyph width is
// close enough to keep labels inside their shapes and away from each other.

const CHAR_WIDTH = 0.56 // average glyph width in em

export const textWidth = (text: string, size: number) => text.length * size * CHAR_WIDTH
export const lineHeight = (size: number) => size * 1.25

/** Greedy word wrap using the estimated glyph width. */
export function wrapText(text: string, size: number, width: number): string[] {
  const maxChars = Math.max(8, Math.floor(width / (size * CHAR_WIDTH)))
  return text.split('\n').flatMap((paragraph) => {
    const lines: string[] = []
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > maxChars) {
        lines.push(line)
        line = word
      } else {
        line = line ? `${line} ${word}` : word
      }
    }
    return [...lines, line]
  })
}
