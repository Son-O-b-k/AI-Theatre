// Binds a compiled scene's elements to Theatre.js sheet objects and pipes their values into the stage.

import { getProject, types, type IProject, type ISheet } from '@theatre/core'
import { hexToRgba, rgbaToCss } from '../scene/color'
import type { Resolved } from '../scene/compile'
import type { SceneElement } from '../scene/schema'
import { SHEET, type TheatreState } from '../scene/theatre'
import type { SvgStage } from './SvgStage'

export interface Mounted {
  sheet: ISheet
  dispose(): void
}

/**
 * Theatre refuses a second getProject() for the same id with a different state object, which happens
 * when a chapter is shown again after its project was reloaded or its keyframes were saved.
 * Within a session the loaded project is the source of truth (Studio edits live there), so reuse it.
 */
const loaded = new Map<string, IProject>()

function project(id: string, state: TheatreState): IProject {
  let existing = loaded.get(id)
  if (!existing) {
    existing = getProject(id, { state })
    loaded.set(id, existing)
  }
  return existing
}

export function mountScene(projectId: string, scene: Resolved, state: TheatreState, stage: SvgStage): Mounted {
  const sheet = project(projectId, state).sheet(SHEET)

  const unsubscribers = scene.elements.map((element) => {
    const object = sheet.object(element.id, theatreProps(element), { reconfigure: true })
    return object.onValuesChange((values) => stage.update(element.id, { ...values, color: rgbaToCss(values.color) }))
  })

  return {
    sheet,
    dispose() {
      sheet.sequence.pause()
      unsubscribers.forEach((unsubscribe) => unsubscribe())
      scene.elements.forEach((element) => sheet.detachObject(element.id))
    },
  }
}

function theatreProps(element: SceneElement) {
  const fraction = (value: number) => types.number(value, { range: [0, 1], nudgeMultiplier: 0.01 })
  return {
    x: element.x,
    y: element.y,
    rotation: element.rotation,
    scale: types.number(element.scale, { nudgeMultiplier: 0.01 }),
    opacity: fraction(element.opacity),
    draw: fraction(element.draw),
    color: types.rgba(hexToRgba(element.color)),
  }
}
