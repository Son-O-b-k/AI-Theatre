import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectSummary } from '../../shared/protocol'
import { api } from '../api'
import { newProject, shortId, type Project } from '../project'

const SAVE_DELAY_MS = 500

/** The open project, kept in React state and saved to the server shortly after each change. */
export function useProjects(onError: (error: unknown) => void) {
  const [summaries, setSummaries] = useState<ProjectSummary[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const latest = useRef<Project | null>(null)
  const dirty = useRef(false)

  const refresh = useCallback(() => api.projects().then(setSummaries).catch(onError), [onError])

  const flush = useCallback(async () => {
    if (!dirty.current || !latest.current) return
    dirty.current = false
    await api.saveProject(latest.current)
    await refresh()
  }, [refresh])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    latest.current = project
    if (!dirty.current) return
    const timer = setTimeout(() => flush().catch(onError), SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [project, flush, onError])

  const update = useCallback((change: (project: Project) => Project) => {
    dirty.current = true
    setProject((current) => current && { ...change(current), updatedAt: new Date().toISOString() })
  }, [])

  const show = useCallback(
    async (next: Project | null) => {
      await flush()
      latest.current = next
      setProject(next)
    },
    [flush],
  )

  const open = useCallback(async (id: string) => show(await api.project(id)), [show])
  const close = useCallback(() => show(null), [show])

  const create = useCallback(
    async (name: string, from?: Project) => {
      const project = from ? { ...from, id: shortId(), name } : newProject(name)
      await api.saveProject(project)
      await show(project)
      await refresh()
      return project
    },
    [show, refresh],
  )

  const remove = useCallback(
    async (id: string) => {
      await api.deleteProject(id)
      if (latest.current?.id === id) {
        dirty.current = false
        await show(null)
      }
      await refresh()
    },
    [show, refresh],
  )

  return { summaries, project, open, close, create, remove, update }
}
