// The viewer's own styles: it runs outside the app (embeds, SCORM), so it cannot rely on Tailwind.

export const VIEWER_CSS = `
.atv { font-family: 'Instrument Sans Variable', 'Inter Variable', system-ui, sans-serif; color: #f3f0e8; background: #1d2422; border-radius: 12px; overflow: hidden; }
.atv:fullscreen { display: flex; flex-direction: column; justify-content: center; border-radius: 0; }
.atv-frame { position: relative; aspect-ratio: 16 / 9; width: 100%; }
.atv:fullscreen .atv-frame { max-height: calc(100vh - 52px); width: auto; margin: 0 auto; }
.atv-stage, .atv-stage svg { position: absolute; inset: 0; width: 100%; height: 100%; cursor: pointer; }
.atv-caption { position: absolute; left: 50%; bottom: 5%; transform: translateX(-50%); width: max-content; max-width: 84%; margin: 0;
  padding: 6px 14px; border-radius: 8px; background: rgba(0, 0, 0, 0.66); font-size: clamp(12px, 1.7vw, 20px); line-height: 1.35;
  text-align: center; font-weight: 500; text-wrap: balance; pointer-events: none; }
.atv-big-play { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 64px; height: 64px; border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.25); background: rgba(0, 0, 0, 0.45); color: #f3f0e8; cursor: pointer; display: grid; place-items: center; }
.atv-big-play svg { width: 28px; height: 28px; margin-left: 3px; }
.atv-big-play[hidden], .atv-caption[hidden] { display: none; }
.atv-empty { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; opacity: 0.7; }
.atv-bar { display: flex; align-items: center; gap: 4px; padding: 6px 8px; background: #151a19; flex-wrap: wrap; }
.atv-button { display: grid; place-items: center; width: 36px; height: 36px; border: 0; border-radius: 8px; background: transparent; color: #f3f0e8; cursor: pointer; }
.atv-button:hover:not(:disabled) { background: rgba(255, 255, 255, 0.1); }
.atv-button:disabled { opacity: 0.35; cursor: default; }
.atv-button.atv-off { opacity: 0.5; }
.atv-title { font-size: 13px; padding: 0 6px; max-width: 30%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.atv-time { font-size: 12px; opacity: 0.7; font-variant-numeric: tabular-nums; padding: 0 6px; }
.atv-track { flex: 1; min-width: 80px; height: 6px; border-radius: 3px; background: rgba(255, 255, 255, 0.15); cursor: pointer; position: relative; }
.atv-fill { height: 100%; width: 0; border-radius: 3px; background: #c8402a; }
@media (max-width: 560px) { .atv-title { display: none; } .atv-track { order: -1; flex-basis: 100%; margin: 4px 4px 6px; } }
`
