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
  onClose(): void
}

export function ExportDialog({ projectId, kind, allowed, onSeePlans, onClose }: Props) {
  const [job, setJob] = useState<ExportStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <Dialog title={WHAT[kind].title} onClose={onClose}>
      <p className="text-sm text-dim">{WHAT[kind].about}</p>
      {!allowed ? (
        <Button variant="primary" size="sm" className="mt-4" onClick={onSeePlans}>
          See plans
        </Button>
      ) : !job || job.status === 'failed' ? (
        <Button variant="primary" size="sm" className="mt-4" onClick={start}>
          {job ? 'Try again' : 'Start export'}
        </Button>
      ) : job.status === 'running' ? (
        <div className="mt-4">
          <div className="flex items-center gap-2 text-sm text-dim">
            <Loader2 className="size-3.5 animate-spin" /> Exporting… {Math.round(job.progress * 100)}%
            <span className="ml-auto text-xs text-faint">You can close this; it keeps going.</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/10">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${job.progress * 100}%` }} />
          </div>
        </div>
      ) : (
        <a href={`/api/exports/${job.id}/file`} download className="mt-4 inline-block">
          <Button variant="primary" size="sm">
            <Download className="size-3.5" /> Download
          </Button>
        </a>
      )}
      {(error || job?.error) && <p className="mt-3 text-sm text-danger">{error ?? job?.error}</p>}
    </Dialog>
  )
}
