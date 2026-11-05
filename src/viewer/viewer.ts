// A lesson viewer without React: the share page, website embeds and SCORM packages all use it.
// It plays the chapters one after another with their recorded narration, captions and brand.

import type { ViewerLesson } from '../../shared/protocol'
import { brandResolved, brandTheatreState } from '../scene/brand'
import { compile } from '../scene/compile'
import type { Scene } from '../scene/schema'
import type { TheatreState } from '../scene/theatre'
import { theatreProjectId } from '../project'
import { mountScene, type Mounted } from '../stage/mount'
import { Player } from '../stage/Player'
import { SvgStage } from '../stage/SvgStage'
import { VIEWER_CSS } from './styles'

export interface ViewerOptions {
  /** Start playing at once (needs an earlier click for sound, as browsers require). */
  autoplay?: boolean
  /** The last chapter finished (SCORM reports completion). */
  onComplete?(): void
  /** Turns a clip or soundtrack URL into the one to load (SCORM packages use relative paths). */
  resolveUrl?(url: string): string
}

const ICONS = {
  play: '<path d="M8 5v14l11-7z" fill="currentColor"/>',
  pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/>',
  prev: '<path d="M6 5h2v14H6zM20 5v14L9 12z" fill="currentColor"/>',
  next: '<path d="M16 5h2v14h-2zM4 5v14l11-7z" fill="currentColor"/>',
  sound: '<path d="M4 9v6h4l5 4V5L8 9zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  muted: '<path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor"/><path d="M17 9l5 5M22 9l-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  captions: '<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 13h4M13 13h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
}

const svgIcon = (name: keyof typeof ICONS) => `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">${ICONS[name]}</svg>`
const time = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, html = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  node.innerHTML = html
  return node
}

function button(name: keyof typeof ICONS, label: string): HTMLButtonElement {
  const b = element('button', 'atv-button', svgIcon(name))
  b.type = 'button'
  b.title = label
  b.setAttribute('aria-label', label)
  return b
}

export function mountViewer(container: HTMLElement, lesson: ViewerLesson, options: ViewerOptions = {}): { destroy(): void } {
  if (!document.getElementById('atv-styles')) {
    const style = element('style', '')
    style.id = 'atv-styles'
    style.textContent = VIEWER_CSS
    document.head.append(style)
  }
  const resolveUrl = options.resolveUrl ?? ((url: string) => url)

  const root = element('div', 'atv')
  const frame = element('div', 'atv-frame')
  const host = element('div', 'atv-stage')
  const caption = element('p', 'atv-caption')
  const bigPlay = element('button', 'atv-big-play', svgIcon('play'))
  bigPlay.setAttribute('aria-label', 'Play')
  frame.append(host, caption, bigPlay)

  const bar = element('div', 'atv-bar')
  const play = button('play', 'Play')
  const prev = button('prev', 'Previous chapter')
  const next = button('next', 'Next chapter')
  const title = element('span', 'atv-title')
  const clock = element('span', 'atv-time')
  const track = element('div', 'atv-track')
  const fill = element('div', 'atv-fill')
  track.append(fill)
  track.setAttribute('role', 'slider')
  track.setAttribute('aria-label', 'Seek')
  const sound = button('sound', 'Narration')
  const captionsButton = button('captions', 'Captions')
  const full = button('full', 'Fullscreen')
  bar.append(play, prev, next, title, track, clock, sound, captionsButton, full)
  root.append(frame, bar)
  container.append(root)

  const stage = new SvgStage(host)
  const chapters = lesson.chapters
  let index = 0
  let player: Player | null = null
  let mounted: Mounted | null = null
  let narrate = true
  let captions = true
  let cues: { text: string }[] = []
  let soundtrack: HTMLAudioElement | null = null

  const show = (i: number, autoplay: boolean) => {
    player?.dispose()
    mounted?.dispose()
    soundtrack?.pause()
    index = i
    const chapter = chapters[i]
    const scene = chapter.scene as Scene
    // Clip URLs are resolved here, so a packaged lesson plays its own copies.
    const withUrls: Scene = { ...scene, cues: scene.cues.map((cue) => (cue.audio ? { ...cue, audio: resolveUrl(cue.audio) } : cue)) }
    const resolved = brandResolved(compile(withUrls), lesson.brand)
    const state = brandTheatreState(chapter.theatreState as TheatreState, lesson.brand)
    stage.render(resolved)
    mounted = mountScene(theatreProjectId(chapter, Boolean(lesson.brand)), resolved, state, stage)
    cues = resolved.cues
    player = new Player(mounted.sheet.sequence, resolved.cues, {
      onCue: (cue) => {
        caption.textContent = cue === null ? '' : cues[cue].text
        caption.hidden = !captions || cue === null
      },
      onPlayingChange: (playing) => {
        play.innerHTML = svgIcon(playing ? 'pause' : 'play')
        bigPlay.hidden = playing
        if (soundtrack) playing ? soundtrack.play().catch(() => {}) : soundtrack.pause()
      },
      onTime: (seconds) => {
        clock.textContent = `${time(seconds)} / ${time(resolved.duration)}`
        fill.style.width = `${(seconds / (resolved.duration || 1)) * 100}%`
      },
      onEnded: () => {
        if (index + 1 < chapters.length) show(index + 1, true)
        else options.onComplete?.()
      },
    }, mounted.sheet.project.ready)
    player.setNarration(narrate)
    soundtrack = chapter.soundtrack ? new Audio(resolveUrl(chapter.soundtrack)) : null
    title.textContent = chapters.length > 1 ? `${i + 1}/${chapters.length} · ${chapter.title}` : chapter.title
    prev.disabled = i === 0
    next.disabled = i === chapters.length - 1
    if (autoplay) player.play()
  }

  play.onclick = bigPlay.onclick = () => player?.toggle()
  host.onclick = () => player?.toggle()
  prev.onclick = () => index > 0 && show(index - 1, true)
  next.onclick = () => index + 1 < chapters.length && show(index + 1, true)
  sound.onclick = () => {
    narrate = !narrate
    player?.setNarration(narrate)
    sound.innerHTML = svgIcon(narrate ? 'sound' : 'muted')
  }
  captionsButton.onclick = () => {
    captions = !captions
    captionsButton.classList.toggle('atv-off', !captions)
    caption.hidden = !captions || !caption.textContent
  }
  full.onclick = () => (document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen())
  const seek = (event: PointerEvent) => {
    const rect = track.getBoundingClientRect()
    player?.seek(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * (player?.duration ?? 0))
  }
  track.onpointerdown = (event) => {
    track.setPointerCapture(event.pointerId)
    seek(event)
  }
  track.onpointermove = (event) => event.buttons === 1 && seek(event)

  if (chapters.length > 0) show(0, Boolean(options.autoplay))
  else frame.append(element('p', 'atv-empty', 'This lesson has no chapters yet.'))

  return {
    destroy() {
      player?.dispose()
      mounted?.dispose()
      soundtrack?.pause()
      stage.destroy()
      root.remove()
    },
  }
}
