# AI Theatre

Ask it to teach you something and it writes an animated, narrated SVG lesson. Theatre.js animates it, and you can keep editing it.

- **Teach me**: the AI plans a 3–6 chapter lesson, then writes each chapter as its own scene.
- **One scene**: a single animated explainer.
- **Refine**: rewrite the selected scene from a follow-up prompt.

Scenes stream in as they are written: elements appear on the stage while the model is still typing.

## Run

```sh
npm install
cp providers.example.json providers.json   # optional, edit to taste
cp .env.example .env                         # optional: database, payment and AI keys
npm run dev                                  # http://localhost:5173
```

The app asks you to create an account. The **first** account created takes over any lessons made before accounts existed (`data/projects/`).

The landing page is at `/` (`src/landing/`) and the app at `/app`. The landing page's example lesson is `src/landing/example.json`, with its narration in `public/example/`.

`npm run build && npm start` serves the built app and API together on port 8787.

## Using it

- **Home**: ask a question. **Full lesson** plans 3–6 chapters and writes them one by one; **Single scene** writes one.
- While chapters are being written, the panel on the right shows the outline. Click the chapter marked *Writing now* to watch it being drawn live, or watch a finished chapter in the meantime.
- **Playback**: chapters play one after another. The progress bar has a tick for each narration line. The space bar plays and pauses. Click any line in **Transcript** to jump to it, or press **Edit** there to change the narration.
- **Change chapter** (the prompt under the player) asks the AI to revise the chapter on screen. **Add chapter** appends one.
- The **speaker** button picks the narration voice for the lesson: one of the recorded voices, the browser's own voice, or off. New chapters are recorded with the voice you chose last.
- The **⋯** menu holds the soundtrack, **Edit keyframes** and exports. **Edit keyframes** opens Theatre Studio on the current chapter's timeline and moves the stage clear of Studio's panels; **Done** keeps your edits.
- **Layout**: the drawing is a fixed 1280×720 canvas, scaled as a whole to fit the window, like a video. Side panels make room so the stage stays readable: the library becomes a drawer below 1600px, and the chapter panel moves under the player below 1200px. The header has theatre mode (player only, Esc to leave) and a toggle for the chapter panel. On a phone, use landscape and fullscreen.

## Providers

`providers.json` lists any number of providers. There are two adapters:

| kind        | covers                                                                                 |
| ----------- | -------------------------------------------------------------------------------------- |
| `openai`    | anything with an OpenAI-compatible `/chat/completions` endpoint: OpenAI, OpenRouter, LM Studio, vLLM, Groq… |
| `ollama`    | the same adapter, defaulting to `http://localhost:11434/v1` with no key                 |
| `anthropic` | the Anthropic Messages API                                                             |

Each entry accepts `id`, `kind`, and optionally `label`, `baseUrl`, `apiKey` (a literal key or `env:NAME`), `models` (a fixed list; otherwise the provider's model list is fetched) and `maxTokens`. Keys stay on the server and never reach the browser.

## How it works

```
prompt ─▶ server/lessons/jobs.ts  a job on the server, metered, streamed to the app as events
        ─▶ server/providers/     the model's answer, as a text stream
        ─▶ src/ai/generate.ts    parses JSON Lines as they arrive, then checks the result
        ─▶ src/scene/scene.ts    validated Scene: elements, layout, actions, narration
        ─▶ src/scene/compile.ts  actions → keyframes
        ─▶ src/scene/theatre.ts  keyframes → Theatre.js project state
        ─▶ src/stage/            Theatre drives SVG attributes directly; Player speaks the narration
```

- **Storyboard format** (`src/scene/schema.ts`). The AI never positions or times anything. It writes:
  - **boards** (screens) with a title and a layout: `row`, `column`, `grid`, `flow` (along the links) or `cycle`
  - **elements**: `box`, `circle`, `icon` (about 100 curated [Lucide](https://lucide.dev) icons), `text` notes, and `link` arrows
  - **beats**: one or two spoken sentences, plus actions that happen while they are said (`show`, `hide`, `focus`, `highlight`, `pulse`, `travel`)

  An element mentioned again on a later board carries over and glides to its new place. The system prompt is in `src/ai/prompts.ts`.
- **Layout engine** (`src/scene/layout.ts`). Places every board: a uniform grid of cells sized to the largest shape (labels included), scaled to fit the safe area between the title and the captions. Notes go under the diagram, gaps leave room for arrows and their labels, and links bend around any shape they would cross.
- **Compiler** (`src/scene/compile.ts`). Turns beats into keyframes. A beat lasts as long as its narration (or its animations, if longer), boards replace each other, and anything declared but never shown appears when it becomes relevant.
- **Forgiving parser** (`src/scene/scene.ts`). Common model mistakes are repaired rather than rejected: invented element kinds, unknown colours, links written before their shapes, actions with extra fields, and ids that were used but never declared (drawn as labelled boxes). Anything still unusable is listed under the prompt.
- **Tests** (`npm test`). Stress boards (long rows, branching flows with back links, cycles, long labels, notes-only boards) must have no overlaps, nothing off the stage, and no links crossing shapes. The tests also cover timing, carry-over and round trips through the AI format and through Theatre.
- **Rendering** (`src/stage/SvgStage.ts`). Each frame only sets attributes on existing nodes, and an element's colour is a single `color` attribute that its parts inherit. Links redraw when their endpoints move.
- **Voice** (`server/speech.ts`, `src/narration.ts`). Each narration line is recorded with [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M), a small open-source voice model that runs on the server's CPU, with no API key or fees. The model (~90 MB) downloads the first time a line is recorded. A line takes about a third of its spoken length to record. Recordings are cached by voice and text, so re-recording only does the lines that changed. Each beat is timed by its recording, so the voice and the animation stay in step. Lines without a recording (older lessons, or when the model cannot load) are read by the browser's speech synthesis instead.
- **Sound** (`src/stage/Player.ts`). The player plays each line's recording as its cue arrives. If a line is still playing when the next one is due, the timeline waits. **Add soundtrack** attaches a music or sound track that Theatre keeps in sync.
- **Editing**: keyframe edits made in Theatre Studio are kept as the chapter's keyframes when you press **Done**. Editing narration in the transcript records that line again and re-times the chapter, which replaces any keyframe edits. Changing the voice does the same.

Chapters made with an earlier format show a notice; **Change chapter** rewrites them in the current one.

## Accounts, plans and billing

Lessons, subscriptions and usage belong to a **workspace**; each account has its own, so people only see their own lessons. Sign-in is by email and password (scrypt hashes, httpOnly session cookies).

- **Email confirmation**: sign-up sends a link (`/app/verify`). Buying a plan needs a confirmed address, because receipts and payment problems go there.
- **Password reset**: "Forgot your password?" emails a link (`/app/reset`) that works once, for an hour, and signs out every other session. The answer never reveals whether an address has an account.
- **Teams**: a workspace has seats (from its plan, or the number in a Teams contract). The owner invites people by email (`/app/invite`); an invitation only works for the address it was sent to, holds a seat while pending, and lasts 7 days. Members share the library and the monthly lessons; only the owner manages people and the plan. Someone in several workspaces switches between them in the sidebar.
- **Invoiced plans**: Teams is sold by quote, so it is switched on from the command line, not through checkout:

  ```sh
  npm run admin -- set-plan owner@school.org teams --seats 10 --months 12 --name "Lagos Science School"
  npm run admin -- end-plan owner@school.org
  ```

### Plan features

Each plan lists what it `allows` in `shared/plans.ts`; the server checks that list (`server/features.ts`), the app hides or explains what is not included.

| Feature | Plans | Where |
| --- | --- | --- |
| Share links and website embeds | Creator, Pro, Teams | `server/shares.ts`; public pages `/s/<id>` and `/embed/<id>` use the viewer in `src/viewer/` |
| MP4 video with captions | Creator, Pro, Teams | `server/exports/video.ts`: frames drawn by the app's own `SvgStage` on a server-side DOM, sampled from the Theatre state (Studio edits included), rasterised with resvg in parallel worker threads, encoded with ffmpeg; narration mixed from the recorded clips |
| Premium voices and other languages | Pro, Teams | `server/speech.ts` (any OpenAI-compatible speech API, set in `.env`), `shared/languages.ts` |
| Brand colours and logo | Pro, Teams | `server/brand.ts`, `src/scene/brand.ts`: applied when lessons are shown, not stored in them |
| Your own AI model and keys | Teams | `server/workspace-providers.ts`: keys encrypted (`server/secrets.ts`); lessons on them do not use the allowance |
| SCORM 1.2 export | Teams | `server/exports/scorm.ts`: the standalone viewer (`npm run build` makes `dist-player/player.js`), lesson and media in one zip; reports completion |
| Single sign-on | Teams | `server/sso.ts`: OpenID Connect (Google Workspace, Microsoft Entra, Okta…), code flow with PKCE, verified ID tokens, accounts and seats on first sign-in, optional "require SSO" |

Workspace settings (team, brand, AI models, single sign-on) are one dialog: **Workspace** in the sidebar.

### Email

All emails are in `server/email/templates/`: `layout.ts` is the shared frame (tables and inline styles, so it renders in every mail client), `index.ts` holds each email's words. `server/email/index.ts` sends them through SMTP when `SMTP_HOST` is set in `.env`, and otherwise writes them to `data/outbox/` and prints their links in the server log, so everything works before an email service is chosen.

**Plans** are defined once in `shared/plans.ts`: prices, monthly lesson allowance and features. The landing page, the app and the server all read that file. Usage is metered in AI tokens (the real cost) and shown as lessons: a typical five-chapter lesson is about 20,000 tokens, so changing or adding a chapter costs a fraction of one. The server checks the plan where money is spent: a lesson job only starts if the allowance covers it (a whole lesson for a new lesson, a quarter for a chapter or a change), a lesson stops between chapters once the allowance runs out, and `/api/speech` (recorded voices) needs a paid plan.

### Lesson jobs

Lessons are written on the server (`server/lessons/jobs.ts`), not in the browser: the app starts a job and follows its progress as server-sent events, including the live preview of the board being drawn. A job keeps going if the tab is closed. Every model call is metered as it happens. One job runs at a time per workspace.

The app stays the only writer of its projects, so the two never overwrite each other: each finished chapter is stored as a *delivery*, the app adds it to the project, saves, and then claims it. Deliveries that were not claimed (tab closed, connection lost) are collected the next time the project is opened, and a job still running is rejoined. The scene engine (`src/scene/`, `src/ai/`, `src/narration.ts`, `src/project.ts`) is plain TypeScript shared by the browser and the server.

**Billing** (`server/billing/`) is split so the payment service can be swapped:

| File | Job |
| --- | --- |
| `types.ts` | The `BillingProvider` interface: checkout, change plan, cancel, resume, parse webhook. |
| `providers/lemonsqueezy.ts` | Lemon Squeezy (merchant of record: cards, tax, invoices, discount codes, customer portal). |
| `providers/dev.ts` | A stand-in for development and tests: checkout completes instantly, no money moves. |
| `service.ts` | The rules, independent of the provider: proration, downgrades, grace periods, idempotent webhooks. |
| `entitlements.ts` | Pure functions: which plan applies now and what it allows. |
| `repo.ts` | The only billing code that knows SQL. |

The rules:

- **Upgrades** apply at once and charge the prorated difference now.
- **Downgrades** switch the price with no charge or credit; the customer keeps the higher plan until the paid period ends.
- **Cancelling** keeps access until the period ends; **resuming** undoes it.
- **Failed payments** keep access while the provider retries (`past_due`); access ends when the subscription expires.
- **Discount codes** are entered at checkout, applied by the provider and recorded with the subscription. **Yearly** plans cost 10 months.
- **Webhooks** are verified by signature and applied once, in a transaction: one that fails half-way is not marked handled, so the provider's retry gets another chance.

Without `billing.json` the dev provider is used, so the whole flow works locally. For real payments, copy `billing.example.json` to `billing.json`, fill in the Lemon Squeezy store and variant ids, put the keys in `.env`, and point the store's webhook at `https://<your site>/api/billing/webhook`. Another service (Paddle, Paystack, Stripe…) is one new file in `providers/` implementing `BillingProvider`, plus a case in `providers/index.ts`.

## Database

Accounts, billing and usage are in a SQL database, chosen by `DATABASE_URL`:

- **Unset**: SQLite in `data/app.db`, using Node's built-in driver. Nothing to install.
- **`postgres://...`**: Postgres, through `pg`.

Both sit behind the small async interface in `server/db/index.ts`, and the schema is created and upgraded on start from `server/db/migrations.ts` (append-only; versions are recorded in `schema_migrations`). The server tests run against either: `TEST_DATABASE_URL=postgres://... npx tsx --test --test-concurrency=1 server/**/*.test.ts`.

## Security notes

- Uploaded logos are served with a Content Security Policy that blocks scripts, so an SVG logo cannot run code.
- Video export uses the ffmpeg binary from `@ffmpeg-installer/ffmpeg` (ffmpeg 4). It only reads our own recordings and soundtracks that a workspace uploaded itself; replace it with a current ffmpeg on servers if that matters to you.
- `npm audit` reports the image library `sharp`, which the voice model's toolkit (`@huggingface/transformers`) installs for image handling. No fixed version exists yet. AI Theatre never passes images to it, so the affected code is not reached; update `kokoro-js` when a fixed release appears.

## Storage and export

Lessons are JSON files in `data/workspaces/<workspace>/projects/`, and uploaded sounds are in `data/workspaces/<workspace>/assets/<project>/`. Recorded narration is in `data/speech/` (about 2.5 MB per minute), shared by all projects, and the voice model is in `data/models/`. Lessons point at their recordings there, so keep it with `data/projects/`.

- **Export** (sidebar): the whole project as JSON, which **Import** loads back.
- **Export animation**: the Theatre.js state, which loads directly with `getProject(id, { state })`.
- **Export frame**: the current frame as an `.svg` file.
