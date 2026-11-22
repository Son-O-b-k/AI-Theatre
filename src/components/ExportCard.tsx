import { CircleAlert, Download, Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ExportStatus } from '../../shared/protocol'
import { api } from '../api'
import { downloadUrl } from './ExportDialog'
import { Button } from './ui/Button'

/**
 * An export running after its dialog was closed (or found running when the app opened): its progress
 * in the corner, then a download when it's ready.
 */
export function useBackgroundExport() {
  const [job, setJob] = useState<ExportStatus | null>(null)

  // After a reload, pick up an export that is still running.
  useEffect(() => {
    api.activeExport().then(setJob, () => {})
  }, [])

  useEffect(() => {
    if (job?.status !== 'running') return
    const timer = setTimeout(() => api.exportStatus(job.id).then(setJob, () => {}), 2000)
    return () => clearTimeout(timer)
  }, [job])

  return { job, track: setJob, dismiss: () => setJob(null) }
}

export function ExportCard({ job, onDismiss }: { job: ExportStatus; onDismiss(): void }) {
  const noun = job.kind === 'mp4' ? 'Video' : 'Course package'
  const name = `“${job.projectName}”`

  return (
    <div
      role="status"
      className="fixed top-20 right-5 z-40 w-80 max-w-[calc(100vw-2.5rem)] rounded-xl border border-line bg-raised p-3.5 shadow-xl shadow-ink/15"
    >
      <div className="flex items-start gap-3">
        {job.status === 'running' ? (
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-accent" />
        ) : job.status === 'done' ? (
          <Download className="mt-0.5 size-4 shrink-0 text-accent" />
        ) : (
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
        )}
        <div className="min-w-0 flex-1 text-[13px] leading-relaxed">
          {job.status === 'running' ? (
            <p>
              Exporting {name}… {Math.round(job.progress * 100)}%
            </p>
          ) : job.status === 'done' ? (
            <p>
              {noun} of {name} is ready.
            </p>
          ) : (
            <p>
              {noun} of {name} failed: {job.error ?? 'something went wrong'}. Try again from the ⋯ menu.
            </p>
          )}
          {job.status === 'running' && (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink/10">
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${job.progress * 100}%` }} />
            </div>
          )}
          {job.status === 'done' && (
            <a href={downloadUrl(job)} download onClick={onDismiss} className="mt-2 inline-block">
              <Button variant="primary" size="sm">
                <Download className="size-3.5" /> Download
              </Button>
            </a>
          )}
        </div>
        {job.status !== 'running' && (
          <Button variant="ghost" size="icon-sm" onClick={onDismiss} aria-label="Dismiss">
            <X className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}
