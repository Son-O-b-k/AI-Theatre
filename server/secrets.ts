// Encryption for secrets stored in the database (a workspace's AI keys, SSO client secrets):
// AES-256-GCM with a key from APP_SECRET in .env. Without it, a random key is generated once and
// kept in data/app-secret.key. Keep that file (or the variable) safe: lose it and stored keys
// must be entered again.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

let key: Buffer | null = null

function secretKey(): Buffer {
  if (key) return key
  let secret = process.env.APP_SECRET
  if (!secret) {
    const file = join(resolve(process.env.DATA_DIR ?? 'data'), 'app-secret.key')
    if (!existsSync(file)) {
      mkdirSync(resolve(file, '..'), { recursive: true })
      writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 })
    }
    secret = readFileSync(file, 'utf8').trim()
  }
  key = createHash('sha256').update(secret).digest()
  return key
}

/** "v1:<iv>:<tag>:<ciphertext>", all base64. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv, cipher.getAuthTag(), data].map((part) => (typeof part === 'string' ? part : part.toString('base64'))).join(':')
}

export function decrypt(sealed: string): string {
  const [version, iv, tag, data] = sealed.split(':')
  if (version !== 'v1') throw new Error('Unknown secret format')
  const decipher = createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
}
