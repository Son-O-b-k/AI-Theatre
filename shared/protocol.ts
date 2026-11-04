// The contract between the browser and the API server.

import type { Interval, PlanId } from './plans'

export type ProviderKind = 'openai' | 'anthropic' | 'ollama'

export interface ProviderInfo {
  id: string
  label: string
  kind: ProviderKind
  models: string[]
  /** Set when the model list could not be fetched (provider offline, missing key, ...). */
  error?: string
}

/** Which configured provider and model to use. */
export interface ModelTarget {
  provider: string
  model: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ProjectSummary {
  id: string
  name: string
  updatedAt: string
  outputCount: number
}

/** A narration voice the server can speak with (`GET /api/speech/voices`). */
export interface VoiceInfo {
  id: string
  label: string
}

/** `POST /api/speech` takes `{ text, voice }` and answers with the recorded clip. */
export interface SpeechClip {
  url: string
  seconds: number
}

/** `GET /api/billing`: the workspace's plan, allowance and subscription. */
export interface BillingSummary {
  plan: PlanId
  tokenAllowance: number
  tokensUsed: number
  canGenerate: boolean
  recordedVoices: boolean
  subscription: {
    plan: PlanId
    interval: Interval
    status: string
    currentPeriodEnd: string | null
    cancelAtPeriodEnd: boolean
    /** A downgrade that takes effect when the paid period ends. */
    scheduledPlan: PlanId | null
    discountCode: string | null
    portalUrl: string | null
  } | null
}

export type Role = 'owner' | 'member'

export interface WorkspaceInfo {
  id: string
  name: string
  role: Role
}

/** `GET /api/auth/me` */
export interface AccountInfo {
  email: string
  emailVerified: boolean
  /** The workspace being worked in, and the role there. */
  workspace: { id: string; role: Role }
  workspaces: WorkspaceInfo[]
  billing: BillingSummary
}

/** `GET /api/team`: the working workspace's people. */
export interface Team {
  workspace: { id: string; name: string }
  seats: number
  members: { userId: string; email: string; role: Role }[]
  invitations: { id: string; email: string; role: Role; expiresAt: string }[]
}

/** `GET /api/team/invitations/:token`: shown before the invited person signs in. */
export interface InvitationDetails {
  workspace: string
  inviter: string
  email: string
}

export type JobMode = 'teach' | 'scene' | 'refine'

/** `POST /api/jobs`: write a lesson, a chapter, or a revision of one, on the server. */
export interface JobRequest extends ModelTarget {
  mode: JobMode
  prompt: string
  projectId: string
  /** Narration voice for new chapters; the browser voice if the plan has no recorded voices. */
  voice: string
  /** The chapter to revise (refine mode), as the app has it now. */
  output?: unknown
}

/** A finished chapter waiting for the app to add it to its project. */
export interface Delivery {
  id: string
  /** An Output (src/project.ts); a revision has the id of the chapter it replaces. */
  output: unknown
}

/** `GET /api/jobs/:id/events` streams these (server-sent events, one JSON object each). */
export type JobEvent =
  | { type: 'status'; text: string }
  | { type: 'plan'; titles: string[]; index: number }
  | { type: 'live'; scene: unknown }
  | { type: 'warning'; message: string }
  | { type: 'output'; delivery: Delivery }
  | { type: 'end'; status: 'done' | 'failed' | 'cancelled'; error?: string }
