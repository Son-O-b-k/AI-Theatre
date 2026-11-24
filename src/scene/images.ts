// The creator's own pictures in a scene. The AI writes {"kind":"photo","image":"img1"} and pins on
// named spots; this fills in what it cannot know (the picture's address, shape, spots and credit)
// from the pictures given with the request, so a stored scene draws without looking anything up.

import type { ImageSpot, LessonImage } from '../../shared/protocol'
import { IMAGE_URL, type Action, type Element, type ElementOf, type Scene } from './schema'

/** The photo's size on stage: its longer side is `size`. */
export function photoSize(el: ElementOf<'photo'>): { w: number; h: number } {
  const aspect = el.aspect ?? 4 / 3
  return aspect >= 1 ? { w: el.size, h: el.size / aspect } : { w: el.size * aspect, h: el.size }
}

/** A place in a photo, 0..1 from its top left: one of its spots, or where one of its pins is. */
export function spotIn(photo: ElementOf<'photo'>, spot: string, elements: Element[]): [number, number] | undefined {
  const named = photo.spots?.[spot] ?? photo.spots?.[findKey(photo.spots, spot) ?? '']
  if (named) return named
  const pin = elements.find((el): el is ElementOf<'pin'> => el.kind === 'pin' && el.id === spot && el.on === photo.id)
  return pin?.at
}

/** Spot names are matched loosely: models write "Cell wall" for "cell wall". */
const findKey = (spots: Record<string, unknown> | undefined, name: string) =>
  Object.keys(spots ?? {}).find((key) => normal(key) === normal(name))
const normal = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '')

export const spotRecord = (spots: ImageSpot[]): Record<string, [number, number]> =>
  Object.fromEntries(spots.map((spot) => [spot.name, [round(spot.x), round(spot.y)]]))

/**
 * Fills in photos from the request's pictures and places pins on their spots. A photo of a picture
 * that was not given (the model made one up) becomes a labelled box; a pin on a place the photo does
 * not have is dropped. Photos already filled in (a chapter being revised) are kept as they are.
 */
export function withImages(scene: Scene, images: LessonImage[] = [], warn: (message: string) => void = () => {}): Scene {
  const byId = new Map(images.map((image) => [image.id, image]))
  const byUrl = new Map(images.map((image) => [image.url, image]))
  let elements = scene.elements.map((el): Element => {
    if (el.kind !== 'photo') return el
    const image = byId.get(el.image) ?? (el.src ? byUrl.get(el.src) : undefined)
    if (image && IMAGE_URL.test(image.url)) {
      return { ...el, src: image.url, aspect: round(image.width / image.height), look: el.look ?? image.look, spots: spotRecord(image.spots), credit: image.credit }
    }
    if (el.src && IMAGE_URL.test(el.src)) return el
    warn(`"${el.id}" shows a picture that was not given ("${el.image}"); drawn as a box`)
    return { id: el.id, kind: 'box', label: el.label ?? el.image, w: 170, h: 110, color: el.color, boards: el.boards, labelAt: el.labelAt }
  })
  elements = elements.flatMap((el): Element[] => {
    if (el.kind !== 'pin') return [el]
    const photo = elements.find((other): other is ElementOf<'photo'> => other.kind === 'photo' && other.id === el.on)
    const at = photo && spotIn(photo, el.spot, [])
    if (!photo || !at) {
      warn(`pin "${el.id}" dropped: ${photo ? `"${el.on}" has no spot "${el.spot}"` : `"${el.on}" is not a photo`}`)
      return []
    }
    // A pin is only where its photo is.
    const boards = el.boards.filter((board) => photo.boards.includes(board))
    return boards.length ? [{ ...el, at, boards, label: el.label ?? el.spot }] : []
  })
  const kept = new Set(elements.map((el) => el.id))
  const beats = scene.beats.map((beat) => ({
    ...beat,
    actions: beat.actions.flatMap((action): Action[] => {
      if (action.type === 'travel') return [action]
      const ids = action.ids.filter((id) => kept.has(id))
      return ids.length ? [{ ...action, ids }] : []
    }),
  }))
  return { ...scene, elements, beats }
}

const round = (n: number) => Math.round(n * 1000) / 1000
