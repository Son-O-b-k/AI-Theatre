/** Splits a byte stream into text lines without the trailing newline. */
export async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        yield buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
      }
    }
    buffer += decoder.decode()
    if (buffer) yield buffer
  } finally {
    // Also runs when the reader stops early (e.g. a lesson outline reached its last chapter):
    // cancelling closes the connection, so the model stops writing and billing.
    await reader.cancel().catch(() => {})
  }
}
