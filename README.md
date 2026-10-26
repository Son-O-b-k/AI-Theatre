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
echo 'ANTHROPIC_API_KEY=sk-...' > .env      # keys referenced as "env:NAME"
npm run dev                                  # http://localhost:5173
```

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
prompt ─▶ server/ (provider adapters) ─▶ NDJSON text stream
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

## Storage and export

Projects are JSON files in `data/projects/`, and uploaded sounds are in `data/assets/<project>/`. Recorded narration is in `data/speech/` (about 2.5 MB per minute), shared by all projects, and the voice model is in `data/models/`. Lessons point at their recordings there, so keep it with `data/projects/`.

- **Export** (sidebar): the whole project as JSON, which **Import** loads back.
- **Export animation**: the Theatre.js state, which loads directly with `getProject(id, { state })`.
- **Export frame**: the current frame as an `.svg` file.
