import type { Interval } from '../shared/plans'
import type {
  AccountInfo,
  BillingSummary,
  Brand,
  Delivery,
  ExportStatus,
  InvitationDetails,
  JobEvent,
  JobRequest,
  ProjectSummary,
  ProviderInfo,
  Share,
  SpeechClip,
  SsoConnection,
  Team,
  VoiceInfo,
  WorkspaceProvider,
  NewWorkspaceProvider,
} from '../shared/protocol'
import type { Project } from './project'

/** An error answer from the API; `status` 401 means signed out, 402 means the plan does not allow it. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function failure(response: Response): Promise<ApiError> {
  const body = await response.json().catch(() => ({}))
  return new ApiError(typeof body.error === 'string' ? body.error : `${response.status} ${response.statusText}`, response.status)
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) throw await failure(response)
  return (response.status === 204 ? undefined : await response.json()) as T
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

type PlanChoice = { plan: 'creator' | 'pro'; interval: Interval }

export const api = {
  me: () => call<AccountInfo>('/api/auth/me'),
  signUp: (email: string, password: string) => call<{ email: string }>('/api/auth/signup', json('POST', { email, password })),
  signIn: (email: string, password: string) => call<{ email: string }>('/api/auth/login', json('POST', { email, password })),
  signOut: () => call<void>('/api/auth/logout', { method: 'POST' }),
  verifyEmail: (token: string) => call<void>('/api/auth/verify', json('POST', { token })),
  resendVerification: () => call<void>('/api/auth/verify/resend', { method: 'POST' }),
  forgotPassword: (email: string) => call<void>('/api/auth/password/forgot', json('POST', { email })),
  resetPassword: (token: string, password: string) => call<{ email: string }>('/api/auth/password/reset', json('POST', { token, password })),
  switchWorkspace: (workspaceId: string) => call<void>('/api/auth/workspace', json('POST', { workspaceId })),

  shareFor: (projectId: string) => call<Share | null>(`/api/shares?projectId=${encodeURIComponent(projectId)}`),
  share: (projectId: string) => call<Share>('/api/shares', json('POST', { projectId })),
  revokeShare: (id: string) => call<void>(`/api/shares/${id}`, { method: 'DELETE' }),

  brand: () => call<Brand | null>('/api/brand'),
  saveBrand: (colors: Omit<Brand, 'logo'>) => call<Brand>('/api/brand', json('PUT', colors)),
  clearBrand: () => call<void>('/api/brand', { method: 'DELETE' }),
  uploadLogo: (file: File) => call<Brand>('/api/brand/logo', { method: 'PUT', headers: { 'content-type': file.type }, body: file }),

  startExport: (projectId: string, kind: 'mp4' | 'scorm') => call<ExportStatus>('/api/exports', json('POST', { projectId, kind })),
  exportStatus: (id: string) => call<ExportStatus>(`/api/exports/${id}`),

  workspaceProviders: () => call<WorkspaceProvider[]>('/api/workspace-providers'),
  addWorkspaceProvider: (provider: NewWorkspaceProvider) => call<WorkspaceProvider>('/api/workspace-providers', json('POST', provider)),
  removeWorkspaceProvider: (id: string) => call<void>(`/api/workspace-providers/${id}`, { method: 'DELETE' }),

  ssoCheck: (email: string) => call<{ sso: boolean; enforced: boolean }>(`/api/auth/sso?email=${encodeURIComponent(email)}`),
  sso: () => call<SsoConnection | null>('/api/team/sso'),
  saveSso: (connection: SsoConnection & { clientSecret?: string }) => call<SsoConnection>('/api/team/sso', json('PUT', connection)),
  removeSso: () => call<void>('/api/team/sso', { method: 'DELETE' }),

  team: () => call<Team>('/api/team'),
  renameTeam: (name: string) => call<Team>('/api/team', json('PATCH', { name })),
  invite: (email: string) => call<Team>('/api/team/invitations', json('POST', { email })),
  revokeInvitation: (id: string) => call<Team>(`/api/team/invitations/${id}`, { method: 'DELETE' }),
  removeMember: (userId: string) => call<Team>(`/api/team/members/${userId}`, { method: 'DELETE' }),
  invitation: (token: string) => call<InvitationDetails>(`/api/team/invitations/${encodeURIComponent(token)}`),
  acceptInvitation: (token: string) => call<void>('/api/team/invitations/accept', json('POST', { token })),

  checkout: (choice: PlanChoice & { discountCode?: string }) => call<{ url: string }>('/api/billing/checkout', json('POST', choice)),
  changePlan: (choice: PlanChoice) => call<BillingSummary>('/api/billing/change', json('POST', choice)),
  cancelPlan: () => call<BillingSummary>('/api/billing/cancel', { method: 'POST' }),
  resumePlan: () => call<BillingSummary>('/api/billing/resume', { method: 'POST' }),

  providers: () => call<ProviderInfo[]>('/api/providers'),
  projects: () => call<ProjectSummary[]>('/api/projects'),
  project: (id: string) => call<Project>(`/api/projects/${id}`),
  saveProject: (project: Project) => call<void>(`/api/projects/${project.id}`, json('PUT', project)),
  deleteProject: (id: string) => call<void>(`/api/projects/${id}`, { method: 'DELETE' }),

  uploadAsset: (projectId: string, file: File) => {
    const name = `${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`
    return call<{ url: string }>(`/api/projects/${projectId}/assets/${name}`, { method: 'PUT', body: file })
  },

  voices: () => call<VoiceInfo[]>('/api/speech/voices'),
  speak: (text: string, voice: string, signal?: AbortSignal) =>
    call<SpeechClip>('/api/speech', { ...json('POST', { text, voice }), signal }),

  startJob: (request: JobRequest) => call<{ id: string }>('/api/jobs', json('POST', request)),
  activeJob: () => call<{ id: string; projectId: string } | null>('/api/jobs/active'),
  cancelJob: (id: string) => call<void>(`/api/jobs/${id}/cancel`, { method: 'POST' }),
  deliveries: (projectId: string) => call<Delivery[]>(`/api/jobs/deliveries?projectId=${encodeURIComponent(projectId)}`),
  claimDeliveries: (ids: string[]) => call<void>('/api/jobs/deliveries/claim', json('POST', { ids })),
  /** A job's events as they happen (server-sent events); close the source when done. */
  jobEvents: (id: string, onEvent: (event: JobEvent) => void) => {
    const source = new EventSource(`/api/jobs/${id}/events`)
    source.onmessage = (message) => onEvent(JSON.parse(message.data))
    return source
  },
}
