import { Download, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ExportStatus } from '../../shared/protocol'
import { api } from '../api'
import { Button } from './ui/Button'
import { Dialog } from './ui/Dialog'

const WHAT = {
  mp4: { title: 'Export a video', about: 'An MP4 of the whole lesson with its narration and captions, for YouTube, social media or class.' },
  scorm: { title: 'Export for your LMS', about: 'A SCORM 1.2 package that Moodle, Canvas, TalentLMS and other learning systems import as a course. It reports completion.' },
}

interface Props {
  projectId: string
  kind: 'mp4' | 'scorm'
  allowed: boolean
  onSeePlans(): void
  /** Closing while an export runs hands it to the app, which shows its progress in the corner. */
  onClose(running: ExportStatus | null): void
}

/** "5 minutes ago", "yesterday"… */
export function ago(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
}

export const downloadUrl = (job: ExportStatus) => `/api/exports/${job.id}/file`

/**
 * Starts an export, or shows the lesson's latest one: still running (with its progress) or ready to
 * download. So reopening Export always shows where things are.
 */
export function ExportDialog({ projectId, kind, allowed, onSeePlans, onClose }: Props) {
  const [job, setJob] = useState<ExportStatus | null | undefined>(allowed ? undefined : null)
  const [error, setError] = useState<string | null>(null)

  // The latest export of this lesson, if any.
  useEffect(() => {
    if (!allowed) return
    api.latestExport(projectId, kind).then(setJob, () => setJob(null))
  }, [projectId, kind, allowed])

  // Poll while it runs.
  useEffect(() => {
    if (job?.status !== 'running') return
    const timer = setTimeout(() => api.exportStatus(job.id).then(setJob, (e) => setError(e.message)), 1000)
    return () => clearTimeout(timer)
  }, [job])

  const start = () => {
    setError(null)
    api.startExport(projectId, kind).then(setJob, (e) => setError(e.message))
  }

  const close = () => onClose(job?.status === 'running' ? job : null)
  const noun = kind === 'mp4' ? 'video' : 'package'

  return (
    <Dialog title={WHAT[kind].title} onClose={close}>
      <p className="text-sm text-dim">{WHAT[kind].about}</p>
      {!allowed ? (
        <Button variant="primary" size="sm" className="mt-4" onClick={onSeePlans}>
          See plans
        </Button>
      ) : job === undefined ? (
        <Loader2 className="mt-4 size-4 animate-spin text-faint" />
      ) : job?.status === 'running' ? (
        <div className="mt-4">
          <div className="flex items-center gap-2 text-sm text-dim">
            <Loader2 className="size-3.5 animate-spin" /> Exporting… {Math.round(job.progress * 100)}%
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/10">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${job.progress * 100}%` }} />
          </div>
          <p className="mt-3 text-xs text-faint">
            You can close this. The progress stays in the top corner, and you can download the {noun} there or here when it's ready.
          </p>
        </div>
      ) : job?.status === 'done' ? (
        <div className="mt-4">
          <p className="text-sm text-dim">Your {noun} is ready. Made {ago(job.createdAt)}.</p>
          <div className="mt-3 flex gap-2">
            <a href={downloadUrl(job)} download>
              <Button variant="primary" size="sm">
                <Download className="size-3.5" /> Download
              </Button>
            </a>
            <Button size="sm" onClick={start} title="Make it again, with the lesson as it is now">
              Export again
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="primary" size="sm" className="mt-4" onClick={start}>
          {job ? 'Try again' : 'Start export'}
        </Button>
      )}
      {(error || job?.error) && <p className="mt-3 text-sm text-danger">{error ?? job?.error}</p>}
    </Dialog>
  )
}
