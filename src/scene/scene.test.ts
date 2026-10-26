// Run with `npm test`. Proves the layout engine's promise: whatever a model writes, shapes do not
// overlap, leave the stage, or get crossed by links, and timing follows the narration.

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { SCENE_SYSTEM } from '../ai/prompts'
import { BROWSER_VOICE, unrecorded, withNarration } from '../narration'
import { editNarration, newOutput } from '../project'
import { checkScene } from './check'
import { compile, speechSeconds } from './compile'
import { applyOp, emptyScene, finalizeScene, sceneToLines } from './scene'
import { parseOp, type Scene } from './schema'
import { fromTheatreState, toTheatreState } from './theatre'

const GEOMETRY_PROBLEM = /overlap|edge of the|crosses|too short/

function build(lines: object[]): { scene: Scene; warnings: string[] } {
  const warnings: string[] = []
  let scene = emptyScene()
  for (const line of lines) scene = applyOp(scene, parseOp(line), (message) => warnings.push(message))
  return { scene: finalizeScene(scene, (message) => warnings.push(message)), warnings }
}

const fromJsonLines = (text: string) => text.trim().split('\n').map((line) => JSON.parse(line))
const boxes = (prefix: string, labels: string[]) => labels.map((label, i) => ({ op: 'el', id: `${prefix}${i + 1}`, kind: 'box', label }))
const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`)

const geometryProblems = (scene: Scene) => checkScene(compile(scene)).filter((issue) => GEOMETRY_PROBLEM.test(issue))

const CASES: Record<string, object[]> = {
  'the prompt example': fromJsonLines(SCENE_SYSTEM.split('EXAMPLE\n')[1].split('\n\n')[0]),

  // The chapter that rendered badly: six tokens in a row, links skipping neighbours, a heading-like note.
  'attention over a row of tokens': [
    { op: 'board', title: 'Attention links related tokens', layout: 'row' },
    ...boxes('t', ['The cat', 'sat', 'on', 'the', 'mat', '!']),
    { op: 'link', id: 'l1', from: 't1', to: 't2' },
    { op: 'link', id: 'l2', from: 't1', to: 't3' },
    { op: 'link', id: 'l3', from: 't2', to: 't4' },
    { op: 'link', id: 'l4', from: 't3', to: 't5' },
    { op: 'link', id: 'l5', from: 't4', to: 't6' },
    { op: 'link', id: 'l6', from: 't5', to: 't6' },
    { op: 'el', id: 'note', kind: 'text', text: 'Tokens (from embeddings)' },
    { op: 'beat', say: 'Each token looks at the others.', do: [{ show: ids('t', 6) }, { show: ids('l', 6) }] },
  ],

  'twelve boxes wrap onto rows': [
    { op: 'board', title: 'A long sequence', layout: 'row' },
    ...boxes('b', ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']),
    { op: 'beat', say: 'Lots of steps.', do: [{ show: ids('b', 12) }] },
  ],

  'branching flow with skip links and a cycle': [
    { op: 'board', title: 'Request path', layout: 'flow' },
    { op: 'el', id: 'user', kind: 'icon', icon: 'user', label: 'User' },
    { op: 'el', id: 'dns', kind: 'box', icon: 'globe', label: 'DNS lookup' },
    { op: 'el', id: 'lb', kind: 'box', icon: 'network', label: 'Load balancer' },
    { op: 'el', id: 's1', kind: 'box', icon: 'server', label: 'Server A' },
    { op: 'el', id: 's2', kind: 'box', icon: 'server', label: 'Server B' },
    { op: 'el', id: 'db', kind: 'circle', icon: 'database', label: 'Database' },
    { op: 'el', id: 'cache', kind: 'circle', icon: 'zap', label: 'Cache' },
    { op: 'link', id: 'a', from: 'user', to: 'dns' },
    { op: 'link', id: 'b', from: 'dns', to: 'lb' },
    { op: 'link', id: 'c', from: 'lb', to: 's1' },
    { op: 'link', id: 'd', from: 'lb', to: 's2' },
    { op: 'link', id: 'e', from: 's1', to: 'db' },
    { op: 'link', id: 'f', from: 's2', to: 'db' },
    { op: 'link', id: 'g', from: 'user', to: 'lb', label: 'skip' },
    { op: 'link', id: 'h', from: 'db', to: 'lb', label: 'reply' },
    { op: 'link', id: 'i', from: 's1', to: 'cache' },
    { op: 'beat', say: 'A request travels through.', do: [{ travel: 'req', along: 'a' }, { travel: 'req', along: 'b' }] },
  ],

  'a cycle of six stages': [
    { op: 'board', title: 'The water cycle', layout: 'cycle' },
    { op: 'el', id: 'c1', kind: 'icon', icon: 'sun', label: 'Evaporation' },
    { op: 'el', id: 'c2', kind: 'icon', icon: 'cloud', label: 'Condensation' },
    { op: 'el', id: 'c3', kind: 'icon', icon: 'droplet', label: 'Precipitation' },
    { op: 'el', id: 'c4', kind: 'icon', icon: 'mountain', label: 'Collection' },
    { op: 'el', id: 'c5', kind: 'icon', icon: 'waves', label: 'Runoff' },
    { op: 'el', id: 'c6', kind: 'icon', icon: 'sprout', label: 'Transpiration' },
    ...[1, 2, 3, 4, 5, 6].map((i) => ({ op: 'link', id: `k${i}`, from: `c${i}`, to: `c${(i % 6) + 1}` })),
    { op: 'beat', say: 'Water goes round and round.', do: [] },
  ],

  'a column with long labels and notes': [
    { op: 'board', title: 'Layers of a network', layout: 'column' },
    ...boxes('n', ['Input embedding layer', 'Self-attention block', 'Feed-forward network', 'Layer normalisation', 'Output probabilities']),
    { op: 'el', id: 'x1', kind: 'text', text: 'Each layer refines the representation a little more.' },
    { op: 'el', id: 'x2', kind: 'text', text: 'softmax(QKᵀ / √d) · V' },
    { op: 'beat', say: 'Information flows upward through the layers.', do: [{ show: ids('n', 5) }] },
  ],

  'a grid of circles, a notes-only board and a second flow': [
    { op: 'board', title: 'Ingredients', layout: 'grid' },
    ...Array.from({ length: 9 }, (_, i) => ({ op: 'el', id: `g${i + 1}`, kind: 'circle', label: `Item ${i + 1}` })),
    { op: 'beat', say: 'Nine ingredients.', do: [{ show: ids('g', 9) }] },
    { op: 'board', title: 'Definition' },
    { op: 'el', id: 'def', kind: 'text', text: 'Compound interest is interest earned on interest.', size: 40 },
    { op: 'beat', say: 'Here is the definition.', do: [{ show: 'def' }] },
    { op: 'board', layout: 'flow' },
    { op: 'el', id: 'p', kind: 'box', label: 'Principal' },
    { op: 'el', id: 'r', kind: 'box', label: 'Rate' },
    { op: 'el', id: 'v', kind: 'box', label: 'Value', w: 300, h: 160 },
    { op: 'link', id: 'pr', from: 'p', to: 'v' },
    { op: 'link', id: 'rv', from: 'r', to: 'v' },
    { op: 'link', id: 'vp', from: 'v', to: 'p', label: 'reinvest' },
    { op: 'beat', say: 'Value feeds back into the principal.', do: [{ show: ['p', 'r', 'v'] }] },
  ],
}

describe('layout', () => {
  for (const [name, lines] of Object.entries(CASES)) {
    test(`${name}: no overlaps, nothing off stage, links clear`, () => {
      const { scene } = build(lines)
      assert.deepEqual(geometryProblems(scene), [])
    })
  }
})

describe('storyboard', () => {
  test('every declared element appears, even if the AI never shows it', () => {
    const { scene } = build([
      { op: 'board', layout: 'flow' },
      { op: 'el', id: 'a', kind: 'box', label: 'A' },
      { op: 'el', id: 'b', kind: 'box', label: 'B' },
      { op: 'link', id: 'ab', from: 'a', to: 'b' },
      { op: 'beat', say: 'Something happens.', do: [] },
    ])
    assert.deepEqual(checkScene(compile(scene)).filter((issue) => issue.includes('never visible')), [])
  })

  test('beats last as long as their narration, in order', () => {
    const { scene } = build(CASES['the prompt example'])
    const { cues, duration } = compile(scene)
    for (let i = 1; i < cues.length; i++) {
      assert.ok(cues[i].t >= cues[i - 1].t + speechSeconds(cues[i - 1].text), `line ${i} starts before line ${i - 1} can finish`)
    }
    assert.ok(duration >= cues.at(-1)!.t + speechSeconds(cues.at(-1)!.text))
  })

  test('mistakes in a beat are reported and skipped, the rest is kept', () => {
    const { scene, warnings } = build([
      { op: 'board' },
      { op: 'el', id: 'a', kind: 'box', label: 'A' },
      { op: 'link', id: 'bad', from: 'a', to: 'ghost' },
      { op: 'beat', say: 'Hello.', do: [{ show: ['a', 'ghost'] }, { move: 'a', to: 'center' }, { travel: 't', along: 'nowhere' }] },
    ])
    // "ghost" gets a stand-in box, the unknown "move" and the travel along nothing are skipped.
    assert.equal(warnings.length, 3)
    assert.deepEqual(scene.beats[0].actions, [{ type: 'show', ids: ['a', 'ghost'], fx: undefined }])
    assert.equal(scene.elements.find((el) => el.id === 'ghost')?.kind, 'box')
  })

  test('a later board can build on shapes from an earlier one: they carry over and glide', () => {
    const { scene, warnings } = build([
      { op: 'board', title: 'Query and keys', layout: 'column' },
      { op: 'el', id: 'q', kind: 'box', label: 'Query' },
      { op: 'el', id: 'k1', kind: 'circle', label: 'Key 1' },
      { op: 'el', id: 'k2', kind: 'circle', label: 'Key 2' },
      { op: 'beat', say: 'One query, two keys.', do: [{ show: ['q', 'k1', 'k2'] }] },
      { op: 'board', title: 'Scores', layout: 'flow' },
      // Links written before anything is declared on this board, pointing at the previous board's shapes.
      { op: 'link', id: 'l1', from: 'q', to: 'k1', label: '0.8' },
      { op: 'link', id: 'l2', from: 'q', to: 'k2', label: '0.2' },
      { op: 'beat', say: 'The query scores each key.', do: [{ show: ['l1', 'l2'] }, { pulse: 'k1', color: 'red' }] },
    ])
    assert.deepEqual(warnings, [])
    assert.deepEqual(scene.elements.find((el) => el.id === 'q')?.boards, [0, 1])
    const { keys } = compile(scene)
    assert.ok(keys.some((key) => key.el === 'q' && key.prop === 'x'), 'the query glides to its place on the second board')
    const opacity = keys.filter((key) => key.el === 'q' && key.prop === 'opacity').sort((a, b) => a.t - b.t)
    const shown = opacity.findIndex((key) => key.v === 1)
    assert.ok(shown !== -1 && opacity.slice(shown).every((key) => key.v !== 0), 'and once shown it never disappears')
    assert.deepEqual(geometryProblems(scene), [])
  })

  test('a flow without links is laid out as a row, not one tall column', () => {
    const { scene } = build([{ op: 'board', layout: 'flow' }, ...boxes('f', ['a', 'b', 'c', 'd'])])
    const ys = new Set(compile(scene).elements.filter((el) => el.kind === 'box').map((el) => Math.round(el.y)))
    assert.equal(ys.size, 1)
  })

  test('invented kinds, kind-named ops and declared dots are understood', () => {
    const { scene, warnings } = build([
      { op: 'board', layout: 'flow' },
      { op: 'el', id: 'browser', kind: 'rectangle', label: 'Browser', icon: 'laptop' },
      { op: 'box', id: 'server', label: 'Server', icon: 'server' },
      { op: 'el', id: 'wire', kind: 'arrow', from: 'browser', to: 'server', label: 'Request (encrypted)' },
      { op: 'el', id: 'note', kind: 'label', text: 'TLS wraps every request' },
      { op: 'el', id: 'data', kind: 'dot', label: 'Your data' },
      { op: 'el', id: 'thing', kind: 'widget', label: 'Mystery' },
      { op: 'beat', say: 'Your data travels encrypted.', do: [{ travel: 'data', along: 'wire' }] },
    ])
    assert.deepEqual(warnings, [])
    const kinds = Object.fromEntries(scene.elements.map((el) => [el.id, el.kind]))
    assert.deepEqual(kinds, { browser: 'box', server: 'box', wire: 'link', note: 'text', data: 'circle', thing: 'box', 'data-token': 'dot' })
    assert.deepEqual(geometryProblems(scene), [])
  })

  test('unknown colours fall back instead of losing the element', () => {
    const { scene, warnings } = build([
      { op: 'board' },
      { op: 'el', id: 'a', kind: 'box', label: 'A', color: 'yellow' },
      { op: 'el', id: 'b', kind: 'box', label: 'B', color: 'neon glow' },
      { op: 'beat', say: 'Two boxes.', do: [{ show: ['a', 'b'] }, { highlight: 'b', color: 'sparkly' }] },
    ])
    assert.deepEqual(warnings, [])
    assert.deepEqual(scene.elements.map((el) => el.color), ['#fbbf24', '#60a5fa'])
    assert.deepEqual(scene.beats[0].actions[1], { type: 'highlight', ids: ['b'], color: 'amber' })
  })

  test('the scene survives being written back out for the AI', () => {
    for (const lines of Object.values(CASES)) {
      const { scene } = build(lines)
      const { scene: again } = build(fromJsonLines(sceneToLines(scene)))
      assert.deepEqual(again, scene)
    }
  })

  test('keyframes survive a round trip through Theatre', () => {
    const { scene } = build(CASES['branching flow with skip links and a cycle'])
    const edited = fromTheatreState(scene, toTheatreState(compile(scene)))
    assert.equal(compile(edited).keys.length > 0, true)
    assert.deepEqual(compile(edited).elements, compile(scene).elements)
  })
})

describe('recorded narration', () => {
  const lesson = () =>
    build([
      { op: 'board', title: 'Two steps' },
      ...boxes('s', ['Ask', 'Answer']),
      { op: 'beat', say: 'First you ask.', do: [{ show: 's1' }] },
      { op: 'beat', say: 'Then you get an answer.', do: [{ show: 's2' }] },
    ]).scene
  const clip = (seconds: number) => ({ url: `/api/speech/${seconds}.wav`, seconds })

  test('each beat lasts as long as its recording, and its cue plays it', () => {
    const scene = lesson()
    const clips = new Map([
      ['First you ask.', clip(6)],
      ['Then you get an answer.', clip(1)],
    ])
    const narrated = withNarration(scene, 'af_heart', clips)
    const [first, second] = narrated.cues
    assert.equal(second.t - first.t > 6, true, 'the long recording pushes the next beat back')
    assert.equal(first.audio, '/api/speech/6.wav')
    assert.deepEqual(unrecorded(narrated, 'af_heart'), [])
    assert.equal(unrecorded(narrated, 'am_michael').length, 2)
  })

  test('an edited line loses its recording; the others keep theirs', () => {
    const scene = withNarration(lesson(), 'af_heart', new Map([['First you ask.', clip(3)], ['Then you get an answer.', clip(3)]]))
    const output = newOutput('Two steps', scene, { prompt: '', provider: '', model: '', at: '' })
    const edited = editNarration(output, 1, 'Then the answer comes back.')
    assert.deepEqual(unrecorded(edited.scene, 'af_heart'), ['Then the answer comes back.'])
    assert.equal(edited.scene.cues[0].audio, '/api/speech/3.wav')
    assert.equal(edited.scene.cues[1].audio, undefined)
  })

  test('the browser voice drops recordings, and a scene already narrated is left alone', () => {
    const narrated = withNarration(lesson(), 'af_heart', new Map([['First you ask.', clip(3)], ['Then you get an answer.', clip(3)]]))
    assert.equal(withNarration(narrated, 'af_heart'), narrated)
    const browser = withNarration(narrated, BROWSER_VOICE)
    assert.equal(browser.voice, undefined)
    assert.deepEqual(browser.cues, lesson().cues)
  })
})
