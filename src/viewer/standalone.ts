// The viewer as one script for SCORM packages: plays window.AI_THEATRE_LESSON and reports to the
// learning system through the SCORM 1.2 API (cmi.core.lesson_status) when the lesson ends.

import type { ViewerLesson } from '../../shared/protocol'
import { mountViewer } from './viewer'

interface Scorm12 {
  LMSInitialize(arg: ''): string
  LMSFinish(arg: ''): string
  LMSGetValue(key: string): string
  LMSSetValue(key: string, value: string): string
  LMSCommit(arg: ''): string
}

/** The LMS puts the API object on a parent (or opener) window. */
function findApi(): Scorm12 | null {
  for (let win: Window | null = window; win; win = win.parent === win ? win.opener : win.parent) {
    const api = (win as unknown as { API?: Scorm12 }).API
    if (api) return api
    if (win.parent === win && !win.opener) break
  }
  return null
}

const lesson = (window as unknown as { AI_THEATRE_LESSON: ViewerLesson }).AI_THEATRE_LESSON
const scorm = findApi()
scorm?.LMSInitialize('')
if (scorm && scorm.LMSGetValue('cmi.core.lesson_status') === 'not attempted') {
  scorm.LMSSetValue('cmi.core.lesson_status', 'incomplete')
  scorm.LMSCommit('')
}
window.addEventListener('pagehide', () => scorm?.LMSFinish(''))

mountViewer(document.getElementById('lesson')!, lesson, {
  // Clips, soundtracks and the logo are packaged next to this page.
  resolveUrl: (url) => `media/${url.split('?')[0].split('/').pop()}`,
  onComplete() {
    scorm?.LMSSetValue('cmi.core.lesson_status', 'completed')
    scorm?.LMSCommit('')
  },
})
