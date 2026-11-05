// SCORM 1.2 package: the standalone player, the lesson and its media in one zip that learning
// systems (Moodle, Canvas, TalentLMS, Cornerstone...) import as a course. It reports "completed"
// when the last chapter ends.

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import type { Brand } from '../../shared/protocol'
import type { Project } from '../../src/project'
import type { Scene } from '../../src/scene/schema'
import { readLogo } from '../brand'
import { escape } from '../email/templates/layout'
import { toViewerLesson } from '../shares'
import { clipFile } from '../speech'
import { zip, type ZipEntry } from './zip'

const PLAYER = resolve('dist-player/player.js')

/** The standalone player script; built on first use in development (`npm run build` makes it for production). */
async function playerScript(): Promise<Buffer> {
  if (!existsSync(PLAYER)) {
    const { build } = await import('vite')
    await build({ configFile: resolve('vite.player.config.ts'), logLevel: 'warn' })
  }
  return readFile(PLAYER)
}

const fileName = (url: string) => url.split('?')[0].split('/').pop()!

function manifest(title: string, files: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="ai-theatre-lesson" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.imsglobal.org/xsd/imsmd_rootv1p2p1 imsmd_rootv1p2p1.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="lesson">
    <organization identifier="lesson">
      <title>${escape(title)}</title>
      <item identifier="item" identifierref="resource"><title>${escape(title)}</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="resource" type="webcontent" adlcp:scormtype="sco" href="index.html">
${files.map((f) => `      <file href="${escape(f)}"/>`).join('\n')}
    </resource>
  </resources>
</manifest>
`
}

function page(title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
  @font-face { font-family: Inter; src: url(fonts/inter.woff2) format('woff2'); font-weight: 100 900; }
  html, body { margin: 0; background: #f4f0e6; }
  #lesson { max-width: 1100px; margin: 0 auto; padding: 16px; }
</style>
</head>
<body>
<div id="lesson"></div>
<script src="lesson.js"></script>
<script src="player.js"></script>
</body>
</html>
`
}

export interface ScormOptions {
  project: Project
  brand: Brand | null
  workspaceId: string
  /** The file of an uploaded soundtrack, from its URL. */
  assetPath(url: string): string
  output: string
  onProgress(share: number): void
}

export async function exportScorm({ project, brand, workspaceId, assetPath, output, onProgress }: ScormOptions): Promise<void> {
  const lesson = toViewerLesson(project, brand, (url) => url)
  const entries: ZipEntry[] = []
  const media = new Map<string, Buffer>()

  for (const chapter of lesson.chapters) {
    for (const cue of (chapter.scene as Scene).cues) {
      if (!cue.audio || media.has(fileName(cue.audio))) continue
      const data = await readFile(clipFile(fileName(cue.audio))).catch(() => null)
      if (data) media.set(fileName(cue.audio), data)
    }
    if (chapter.soundtrack) media.set(fileName(chapter.soundtrack), await readFile(assetPath(chapter.soundtrack)))
  }
  if (brand?.logo) {
    const logo = await readLogo(workspaceId)
    if (logo) media.set(fileName(brand.logo), logo.data)
  }
  onProgress(0.4)

  const require = createRequire(import.meta.url)
  const font = await readFile(require.resolve('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'))
  // The packaged page loads the logo from media/ like everything else.
  const packaged = { ...lesson, brand: brand && { ...brand, logo: brand.logo ? `media/${fileName(brand.logo)}` : undefined } }
  entries.push(
    { name: 'index.html', data: Buffer.from(page(project.name)) },
    { name: 'lesson.js', data: Buffer.from(`window.AI_THEATRE_LESSON = ${JSON.stringify(packaged).replace(/</g, '\\u003c')};\n`) },
    { name: 'player.js', data: await playerScript() },
    { name: 'fonts/inter.woff2', data: font },
    ...[...media].map(([name, data]) => ({ name: `media/${name}`, data })),
  )
  onProgress(0.8)
  entries.unshift({ name: 'imsmanifest.xml', data: Buffer.from(manifest(project.name, entries.map((e) => e.name))) })
  await writeFile(output, zip(entries))
  onProgress(1)
}
