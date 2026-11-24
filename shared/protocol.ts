// The contract between the browser and the API server.

import type { Feature, Interval, PlanId } from './plans'

export type ProviderKind = 'openai' | 'anthropic' | 'ollama'

/** Where a model comes from: the plan's default, another model the plan includes, or the workspace's own key. */
export type ProviderSource = 'default' | 'included' | 'own'

/** The id that means "the server's default model" (AI_DEFAULT_PROVIDER / AI_DEFAULT_MODEL in .env). */
export const DEFAULT_PROVIDER_ID = 'default'

export interface ProviderInfo {
  id: string
  label: string
  kind: ProviderKind
  source: ProviderSource
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
  /** A premium voice (Pro and Teams), able to speak every supported language. */
  premium?: boolean
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
  /** Tokens a month with the workspace's own AI key; null when unlimited. */
  ownKeyAllowance: number | null
  ownKeyTokensUsed: number
  canGenerateOwnKey: boolean
  /** What the plan unlocks beyond lessons and seats. */
  features: Feature[]
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
  /** The workspace's brand, when its plan includes branding. */
  brand: Brand | null
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
  /** The lesson's language (shared/languages.ts); English when unset. */
  language?: string
  /** The stage's shape (src/scene/schema.ts FORMATS); landscape when unset. */
  format?: 'landscape' | 'portrait' | 'square'
  /** Material to teach from (a document's text, at most MAX_SOURCE_CHARS); new lessons and chapters only. */
  source?: string
  /** The creator's own pictures, which the lesson may show, point at and zoom into. */
  images?: LessonImage[]
}

export const MAX_LESSON_IMAGES = 8

/** A picture a creator gave a lesson (`POST /api/images`, or imported from a free library). */
export interface LessonImage {
  /** What the model calls it in this request ("img1"). */
  id: string
  /** Where it is served: `/api/images/<hash>.<ext>`. */
  url: string
  width: number
  height: number
  /** What it shows, in the creator's words: the model cannot see the picture. */
  about: string
  /** Shown as the photo, or traced as a drawing that sketches itself in. */
  look: 'photo' | 'sketch'
  /** Named places in the picture (0..1 from its top left) that a lesson can point at and zoom into. */
  spots: ImageSpot[]
  /** Who made it and its licence, shown on the picture (free library images). */
  credit?: string
}

export interface ImageSpot {
  name: string
  x: number
  y: number
}

/** `POST /api/images`: a stored picture. */
export interface StoredImage {
  url: string
  width: number
  height: number
  credit?: string
}

/** `GET /api/images/search`: openly licensed pictures (Openverse) that may be used commercially and adapted. */
export interface ImageSearchResult {
  id: string
  title: string
  thumbnail: string
  width?: number
  height?: number
  credit: string
  /** The page the picture comes from. */
  page: string
}

/**
 * Source material is sent with every model call of a job (the outline and each chapter), so it is
 * capped: about 3,000 words, roughly ten pages, adds about a lesson's allowance to a full lesson.
 */
export const MAX_SOURCE_CHARS = 20_000

/** `POST /api/sources`: the text of an uploaded document, cut to MAX_SOURCE_CHARS. */
export interface SourceText {
  name: string
  text: string
  words: number
  /** The document was longer than MAX_SOURCE_CHARS; only its beginning is used. */
  truncated: boolean
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

/** A workspace's look on its lessons (Pro and Teams). Colours are "#rrggbb". */
export interface Brand {
  /** The stage background. */
  background: string
  /** Replaces the default blue: boxes, cards, most shapes. */
  primary: string
  /** Replaces the default amber: highlights and travelling dots. */
  highlight: string
  /** URL of the logo shown in the corner of the stage, if any. */
  logo?: string
}

/** A lesson as a viewer shows it (share pages, embeds, SCORM): chapters only, no prompts or history. */
export interface ViewerLesson {
  title: string
  brand: Brand | null
  chapters: ViewerChapter[]
}

export interface ViewerChapter {
  id: string
  title: string
  revision: number
  /** A Scene and its TheatreState (src/scene), as stored in the project. */
  scene: unknown
  theatreState: unknown
  /** URL of the chapter's soundtrack, if one was added. */
  soundtrack?: string
}

/** A lesson's public link (`/s/<id>`, embeddable at `/embed/<id>`). */
export interface Share {
  id: string
  projectId: string
  createdAt: string
}

/** `POST /api/exports` and `GET /api/exports/:id`: a video or SCORM package being made. */
export interface ExportStatus {
  id: string
  kind: 'mp4' | 'scorm'
  status: 'running' | 'done' | 'failed'
  /** 0..1 while running. */
  progress: number
  error?: string
  projectId: string
  /** The lesson's name, for "Your video of … is ready". */
  projectName: string
  createdAt: string
}

/** A workspace's own AI provider. The key is stored encrypted and never returned. */
export interface WorkspaceProvider {
  id: string
  label: string
  kind: ProviderKind
  baseUrl?: string
  models: string[]
  hasKey: boolean
}

export interface NewWorkspaceProvider {
  label: string
  kind: ProviderKind
  baseUrl?: string
  apiKey?: string
  /** Models to offer; empty offers every model the provider lists. */
  models?: string[]
}

/** `POST /api/workspace-providers/check`: whether a key works, and the models it can use. */
export interface ProviderCheck {
  models: string[]
}

/** A workspace's single sign-on (OpenID Connect). The client secret is never returned. */
export interface SsoConnection {
  /** Email domain that signs in this way, e.g. "school.org". */
  domain: string
  issuer: string
  clientId: string
  /** Password sign-in is turned off for the domain. */
  enforced: boolean
}
