# Content

What the AI can put on the board, kept apart from the code so it can be managed without
programming. After any change here, run:

```
npm run check:content     # checks everything and updates the app's library
npm run preview:content   # draws every illustration into illustrations/preview.png
```

`npm run dev`, `npm run build` and `npm test` run the check first, so a mistake is reported
straight away with what to fix.

| File | What it holds |
|---|---|
| `lesson-rules.ts` | How many chapters, beats and shapes a lesson may have |
| `icons.json` | Small symbols used inside cards and on their own |
| `illustrations/` | Larger drawings that sketch themselves in |

## Lesson rules

`lesson-rules.ts` sets the usual length of a lesson and the hard limits. The AI is told the usual
range and follows the learner's request ("make it 10 chapters") up to the maximum; the app enforces
the maximums whatever the AI writes.

| Rule | Usual | Maximum |
|---|---|---|
| Chapters per lesson | 3 to 6 | 20 |
| Beats (spoken steps) per chapter | 6 to 12 | 24 |
| Shapes per board | 8 | 12, then a new board starts |

Longer lessons use more of a plan's monthly allowance, because usage is measured in AI tokens.

## Icons

`icons.json` maps the name the AI uses to a [Lucide](https://lucide.dev/icons) icon:

```json
{
  "heart": "heart",
  "chart-bar": "chart-column"
}
```

To add one, find it on lucide.dev, copy its name, and add a line. Keep names short and obvious;
the AI picks icons by name. Lucide is ISC-licensed, so no credit is needed per icon.

## Illustrations

Each drawing is an SVG file plus an entry in `illustrations/illustrations.json`:

```json
"plant-cell": {
  "about": "a plant cell: wall, membrane, nucleus, vacuole and chloroplasts",
  "tags": ["biology", "plants", "cells"],
  "credit": "Drawn by Ada Obi, CC0"
}
```

- **File name** is the name the AI uses: lowercase letters, digits and dashes (`plant-cell.svg`).
- **about** is what the AI reads to decide when to use it, so describe what is in the picture.
- **credit** says who drew it and under which licence. Only add drawings you may use commercially.
- **tags** help people find drawings; the AI does not read them.

### Drawing for the board

Lessons are drawn on a dark chalkboard in the lesson's colours, and a workspace's brand can change
those colours. So drawings are **recoloured**:

- Every line takes the element's colour (white, blue, amber...), like coloured chalk.
- Filled areas become tints of that colour: the darker the fill in your file, the stronger the
  tint. White is a faint wash, mid grey is half strength, black is solid.
- Each filled shape hides what is drawn behind it, as on paper.

When the drawing appears, its lines are drawn one after another in the order they are in the file,
then the fills wash in. Draw outlines before details, and big shapes before small ones, and the
sketching will look natural.

Practical guidance:

- Use a square canvas of about **200 × 200** (`viewBox="0 0 200 200"`), lines **3 to 5** wide,
  round line ends and joins.
- Draw with black lines and grey fills. Avoid colours: they become tints anyway.
- Keep it simple: a few dozen shapes. The drawing is shown about 230 pixels tall.
- Use paths and basic shapes only. Convert text to outlines and expand symbols before exporting.
  Images, text, gradients and effects are not supported and are reported by the check.
- **Figma**: export the frame as SVG. **Inkscape**: save as Plain SVG.
  **Illustrator**: Export As SVG with Styling set to *Presentation Attributes*.

Anything else in the file (scripts, links, styles, metadata) is never used: the check rebuilds each
drawing from its shapes alone, so a file from anywhere is safe to add.

### Removing a drawing

Delete the SVG file and its entry. Lessons that already use it show a labelled box in its place.
