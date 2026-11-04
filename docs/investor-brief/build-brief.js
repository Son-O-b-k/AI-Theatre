// Builds the investor brief from the projection model and screenshots in this folder.
// Rebuild: python3 model.py model.json && npm i --no-save docx@9 && node build-brief.js ../AI-Theatre-Investor-Brief.docx
// (re-draw mrr.svg / mrr.png if the model changes).
const fs = require('fs')
const path = require('path')
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun, AlignmentType, HeadingLevel,
  WidthType, ShadingType, BorderStyle, LevelFormat, PageBreak, Footer, PageNumber, ExternalHyperlink,
} = require('docx')

const SP = __dirname
const OUT = process.argv[2]
const model = JSON.parse(fs.readFileSync(path.join(SP, 'model.json'), 'utf8'))

const INK = '1D1B17', DIM = '5C564C', ACCENT = 'C8402A', RULE = 'D6D2C6', HEAD_FILL = 'F1ECE2'
const SERIF = 'Georgia', SANS = 'Arial'
const CONTENT = 9638 // A4 width minus 2 cm margins, in DXA

const money = (n) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : Math.abs(n) >= 1e3 ? `$${Math.round(n / 1e3).toLocaleString('en-US')}k` : `$${Math.round(n)}`)
const signed = (n) => (n < 0 ? `−${money(-n)}` : money(n))
const num = (n) => Math.round(n).toLocaleString('en-US')
const pct = (n) => `${Math.round(n * 100)}%`

/** Text with **bold** segments. */
function runs(text, opts = {}) {
  return text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((part) =>
    part.startsWith('**') ? new TextRun({ font: SANS, text: part.slice(2, -2), bold: true, ...opts }) : new TextRun({ font: SANS, text: part, ...opts }))
}
const p = (text, opts = {}) => new Paragraph({ children: runs(text, opts.run), spacing: { after: 140, line: 300 }, ...opts.para })
const h1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)] })
const h2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)] })
const bullet = (text) => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: runs(text), spacing: { after: 80, line: 290 } })
const note = (text) => new Paragraph({ children: runs(text, { size: 18, color: DIM, italics: true }), spacing: { after: 200, line: 260 } })
const pageBreak = () => new Paragraph({ children: [new PageBreak()] })

function table(rows, widths, { header = true, firstColBold = false } = {}) {
  const total = widths.reduce((a, b) => a + b, 0)
  const border = { style: BorderStyle.SINGLE, size: 4, color: RULE }
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map((row, r) => new TableRow({
      tableHeader: header && r === 0,
      children: row.map((cell, c) => new TableCell({
        width: { size: widths[c], type: WidthType.DXA },
        borders: { top: border, bottom: border, left: border, right: border },
        shading: header && r === 0 ? { type: ShadingType.CLEAR, color: 'auto', fill: HEAD_FILL } : undefined,
        margins: { top: 70, bottom: 70, left: 110, right: 110 },
        children: [new Paragraph({
          alignment: c > 0 && /^[−$\d]/.test(String(cell)) ? AlignmentType.RIGHT : AlignmentType.LEFT,
          children: runs(String(cell), { size: 18, bold: (header && r === 0) || (firstColBold && c === 0) ? true : undefined }),
        })],
      })),
    })),
  })
}
const spacer = () => new Paragraph({ spacing: { after: 120 }, children: [] })

function image(file, widthPx, heightPx, widthInches) {
  const w = Math.round(widthInches * 96)
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 80 },
    children: [new ImageRun({ type: 'png', data: fs.readFileSync(path.join(SP, file)), transformation: { width: w, height: Math.round((w * heightPx) / widthPx) } })],
  })
}
const caption = (text) => new Paragraph({ alignment: AlignmentType.CENTER, children: runs(text, { size: 17, color: DIM, italics: true }), spacing: { after: 240 } })
const link = (text, url) => new Paragraph({
  numbering: { reference: 'bullets', level: 0 }, spacing: { after: 60 },
  children: [new ExternalHyperlink({ link: url, children: [new TextRun({ text, style: 'Hyperlink', size: 18 })] })],
})

const base = model.base.years, cons = model.conservative.years, up = model.upside.years
const cum24 = model.base.rows[23].cum

// ── Content ────────────────────────────────────────────────────────────────────
const children = [
  // Cover
  new Paragraph({ spacing: { before: 2400, after: 200 }, children: [new TextRun({ text: 'INVESTOR BRIEF · DRAFT FOR DISCUSSION', size: 18, bold: true, color: ACCENT, characterSpacing: 40 })] }),
  new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: 'AI Theatre', font: SERIF, size: 80, bold: true, color: INK })] }),
  new Paragraph({ spacing: { after: 600 }, children: [new TextRun({ text: 'Lessons that draw themselves.', font: SERIF, size: 40, italics: true, color: DIM })] }),
  p('Ask a question and get a short lesson, drawn step by step on a board and explained out loud by a natural voice. Edit it, keep it, share it.', { run: { size: 24 } }),
  new Paragraph({ spacing: { before: 1600 }, children: runs('November 2026', { color: DIM }) }),
  note('All projections in this document are estimates built from stated assumptions. They are not forecasts of guaranteed results. Figures in square brackets are for the founders to complete.'),
  pageBreak(),

  // 1. Summary
  h1('1. Summary'),
  p('**The problem.** Explaining how something works is slow and expensive. A short animated explainer video takes days and usually costs thousands of dollars to produce. Teachers, creators and corporate trainers need far more of them than they can make, and plain-text AI answers do not build real intuition.'),
  p('**The product.** AI Theatre turns one question into a narrated, animated lesson in minutes. It plans the lesson in chapters, draws each idea as a clean diagram, and narrates it with a natural voice that stays in step with the animation. Every line can be edited, and the timing follows. The product works end to end today.'),
  p('**The business.** A freemium subscription for teachers and creators (Creator $15 and Pro $39 per month), followed by team plans for schools and companies. Lessons cost cents to generate, so paid plans carry healthy margins (64–69% gross margin at scale in our model).'),
  p(`**The plan.** In our base case AI Theatre reaches about **${money(base[2].arr)} in annual recurring revenue (ARR)** by the end of year 3, with ${num(base[2].paid)} paying subscribers and ${num(base[2].teams)} team customers. In the upside case that figure is ${money(up[2].arr)}; in the conservative case, ${money(cons[2].arr)}.`),
  p(`**The ask.** We propose raising **[$600,000]** in a pre-seed round, about 24 months of runway in the base case. The base case spends ${money(-cum24)} in that time, leaving roughly a quarter in reserve. The goal is about 1,000 paying users, 20+ team customers and ${money(base[1].arr)} ARR by month 24, which positions us for a seed round.`),
  pageBreak(),

  // 2. Problem and product
  h1('2. The problem'),
  bullet('**Explaining takes time and skill.** Good explainer animation needs a script, a designer, an animator and a voice artist. That rules it out for most lessons a teacher gives or most topics a training team covers.'),
  bullet('**Text answers do not build intuition.** AI assistants answer in paragraphs. Mechanisms such as how a vaccine trains the immune system or how a workflow runs on a server are understood far faster when you watch them happen.'),
  bullet('**Existing video tools solve a different problem.** Avatar video tools put a talking presenter on screen. Animation tools still need someone to draw every scene by hand.'),
  h1('3. The product today'),
  p('AI Theatre is built and working. A user types a question; the product plans a lesson of 3–6 chapters and writes each one as a storyboard of boards, shapes, links and narration. Our layout engine places every diagram automatically, so the AI model never has to position anything. That is what keeps the drawings clean and readable, whichever model is used.'),
  image('app-lesson.png', 1680, 1000, 6.4),
  caption('The app playing chapter 1 of a five-chapter lesson made from one question: “Break down how GitHub executes action workflows.”'),
  h2('What works today'),
  bullet('Lesson planning into chapters, with the first chapter drawing live while the rest are written.'),
  bullet('Automatic layout of every board, with smooth transitions when ideas carry over from one board to the next.'),
  bullet('**Natural recorded narration** from an open-source voice model that runs on our own servers, with 8 voices. A typical 12-minute lesson records in about 4 minutes.'),
  bullet('Animation timed to the actual recorded voice, so picture and sound stay in step.'),
  bullet('Editing: rewrite any line or ask for changes in plain language; a full keyframe editor for fine control.'),
  bullet('Works with OpenAI-compatible models, Anthropic models, and open models running on our own servers.'),
  bullet('Export of lessons as project files and animation data; a public landing page; 19 automated tests covering layout, timing and narration.'),
  pageBreak(),

  // 4. Market
  h1('4. Market'),
  p('We sell into two established markets that are both growing:'),
  table([
    ['Market', '2025 size (published estimates)', 'Growth'],
    ['Corporate training', '$353B – $427B', 'about 5–8% a year'],
    ['AI video generators', '$0.75B – $10.5B (definitions vary widely)', 'about 19–20% a year'],
  ], [2600, 4238, 2800]),
  note('Sources: The Business Research Company, SkyQuest, Roots Analysis and Market.us via GII for corporate training; Straits Research, Grand View Research and TechSci Research for AI video generators. Full links in the appendix.'),
  p('**A signal of demand.** Synthesia, which makes AI avatar videos mainly for corporate training, passed $100M ARR in April 2025 and was valued at $4B in its latest round. Companies are already paying for AI-made training video. AI Theatre addresses the same buyers with a different product: diagrams that show how things work, rather than a presenter who talks about them.'),
  p('**Who we sell to first.** Teachers, tutors and online creators, who decide quickly and pay by card. Then school and company training teams, who buy seats and need exports for their learning systems. A third, later route is an API for education platforms.'),
  h1('5. Competition'),
  table([
    ['Alternative', 'What it does', 'How AI Theatre differs'],
    ['Synthesia and other avatar video tools', 'AI presenter reads a script on camera', 'Shows the mechanism with diagrams; works from a question, not a script'],
    ['Vyond, Powtoon', 'Templates for hand-made animation', 'Generates the whole lesson; minutes instead of days'],
    ['General AI assistants', 'Text, audio and short video summaries', 'Purpose-built lessons that can be edited, exported and used in class or a learning system'],
    ['Course platforms (Brilliant, Khan Academy)', 'Curated library of fixed topics', 'Any topic, on demand, in the user’s own words'],
  ], [2700, 3200, 3738], { firstColBold: true }),
  spacer(),
  p('**Our advantages:** a layout engine that turns imperfect model output into clean diagrams; our own voice stack, which keeps narration cost close to zero; independence from any single AI provider; and an editing model where changing a sentence re-times the animation.'),
  pageBreak(),

  // 6. Business model
  h1('6. Business model'),
  p('A freemium subscription with a monthly lesson allowance, plus team plans. Prices below are our proposed starting points, to be tested with early users.'),
  table([
    ['Plan', 'Price', 'Includes'],
    ['Free', '$0', '3 lessons a month, browser voice, watermark, share links'],
    ['Creator', '$15 / month', '30 lessons a month, natural voices, video (MP4) export, embeds'],
    ['Pro', '$39 / month', '100 lessons a month, premium voices and languages, brand themes, LMS (SCORM) export'],
    ['Teams', 'from about $400 / month', 'Seats, shared library, single sign-on, LMS integration, option to use the customer’s own AI model'],
  ], [1700, 2300, 5638], { firstColBold: true }),
  spacer(),
  p('**Why allowances work here.** Our main cost is AI model usage per lesson. A monthly allowance ties cost to price on every plan, and the free plan uses a low-cost model and the browser voice so that free users cost very little.'),
  p('**Payments.** Card subscriptions through a merchant-of-record service such as Paddle or Lemon Squeezy, which handles sales tax worldwide, and Paystack or Flutterwave for customers paying in naira.'),

  // 7. Unit economics
  h1('7. Unit economics'),
  p('We measured a real five-chapter lesson (12 minutes of narration) made with the current product: about **10,000 input tokens and 10,000 output tokens** of AI model use, plus the voice. We double the token count to allow for retries and longer lessons.'),
  table([
    ['AI model price tier (per million tokens, input / output)', 'Model cost per lesson', 'Use'],
    ['$0.20 / $0.80 (small open model)', '$0.02', 'Free plan'],
    ['$3 / $15 (mid-range model)', '$0.36', 'Creator and Pro plans'],
    ['$15 / $75 (largest models)', '$1.80', 'Optional premium quality'],
  ], [4800, 2200, 2638]),
  note('Voice: about 4 minutes of server CPU per lesson on our own voice model, a few cents at most. Storage: about 6 MB of compressed audio per lesson. The model uses $0.40 per paid lesson and $0.05 per free lesson, all-in.'),
  table([
    ['Per subscriber, per month', 'Creator', 'Pro', 'Blended'],
    ['Price', '$15.00', '$39.00', '$21.00'],
    ['AI and voice (15 lessons at $0.40)', '$6.00', '$6.00', '$6.00'],
    ['Payment fees (5% + $0.50)', '$1.25', '$2.45', '$1.55'],
    ['Contribution', '$7.75 (52%)', '$30.55 (78%)', '$13.45 (64%)'],
  ], [3838, 1900, 1900, 2000], { firstColBold: true }),
  spacer(),
  p('Even a Creator subscriber who uses the full allowance of 30 lessons costs about $13 a month on a mid-range model, so no paid plan loses money. As AI model prices keep falling, margins rise.'),
  pageBreak(),

  // 8. Projections
  h1('8. Financial projections'),
  p('A 36-month model starting January 2027. The first three months are a free beta while we build accounts, billing and video export; paid plans launch in month 4. All assumptions are listed in the appendix.'),
  image('mrr.png', 1600, 760, 6.5),
  caption('Monthly recurring revenue in the three scenarios.'),
  h2('Base case'),
  table([
    ['', 'Year 1', 'Year 2', 'Year 3'],
    ['New free sign-ups', num(base[0].signups), num(base[1].signups), num(base[2].signups)],
    ['Paying subscribers (end of year)', num(base[0].paid), num(base[1].paid), num(base[2].paid)],
    ['Team customers (end of year)', num(base[0].teams), num(base[1].teams), num(base[2].teams)],
    ['ARR (end of year)', money(base[0].arr), money(base[1].arr), money(base[2].arr)],
    ['Revenue', money(base[0].revenue), money(base[1].revenue), money(base[2].revenue)],
    ['Gross margin', pct(base[0].gm), pct(base[1].gm), pct(base[2].gm)],
    ['Operating costs', money(base[0].opex), money(base[1].opex), money(base[2].opex)],
    ['Net result', signed(base[0].net), signed(base[1].net), signed(base[2].net)],
  ], [3838, 1900, 1900, 2000], { firstColBold: true }),
  spacer(),
  h2('Scenarios at the end of year 3'),
  table([
    ['', 'Conservative', 'Base', 'Upside'],
    ['Free-to-paid conversion', '2.0%', '3.0%', '4.5%'],
    ['Monthly subscriber churn', '8%', '6%', '5%'],
    ['Paying subscribers', num(cons[2].paid), num(base[2].paid), num(up[2].paid)],
    ['ARR', money(cons[2].arr), money(base[2].arr), money(up[2].arr)],
    ['Year 3 revenue', money(cons[2].revenue), money(base[2].revenue), money(up[2].revenue)],
    ['Total spent before profit (over 36 months)', money(-model.conservative.low), money(-model.base.low), money(-model.upside.low)],
  ], [3838, 1900, 1900, 2000], { firstColBold: true }),
  spacer(),
  p('The conversion assumptions are anchored on published benchmarks: freemium software typically converts about 2–5% of users to paid, so our base case assumes 3%. Team customers grow from 1 a month to 4 a month by year 3 and churn 1.5% a month.'),
  pageBreak(),

  // 9. Stability and risks
  h1('9. Stability and risks'),
  h2('Why the business is stable'),
  bullet('**Costs scale with usage, not ahead of it.** Infrastructure starts at about $300 a month. Every lesson’s cost is covered by the plan it is made on.'),
  bullet('**No single supplier can hold us hostage.** The product already runs on several AI providers and on open models we can host ourselves. Our voice runs on our own servers.'),
  bullet('**Falling AI prices work in our favour.** Our largest variable cost is model usage, which has been getting cheaper. Lower prices raise our margins directly.'),
  bullet('**Recurring revenue with a path to stickier customers.** Team plans with LMS integration churn far less than individual subscriptions, and lessons in a shared library raise switching costs.'),
  h2('Main risks and how we handle them'),
  table([
    ['Risk', 'What we do about it'],
    ['Large AI companies add similar features', 'Focus on what general assistants do not offer: editing, exports, LMS packages, team libraries. Move fast with early customers.'],
    ['Lessons with factual mistakes', 'Every line is editable; an optional accuracy-check pass with sources; clear guidance to review before teaching.'],
    ['AI provider prices or policies change', 'Multi-provider by design; can switch to self-hosted open models.'],
    ['Licensing of one open-source component', 'The keyframe editor library is AGPL-licensed. Before launch we remove it from the hosted product or replace it with our own editor, and take legal advice.'],
    ['Individual subscribers cancel', 'Annual plans, team plans, and features that build a library users want to keep.'],
    ['Payments from Nigeria', 'Merchant-of-record services for global card payments; Paystack or Flutterwave locally.'],
    ['Data loss or downtime', 'Lessons are stored as files on one server today. Before launch: a database, off-site backups, restorable deletes and monitoring.'],
    ['Video export compute cost', 'Rendering runs as background jobs on ordinary CPUs; exports are counted in each plan’s allowance.'],
    ['Small team (key-person risk)', 'Hire two engineers early; keep the code simple, documented and covered by automated tests.'],
  ], [3200, 6438], { firstColBold: true }),
  pageBreak(),

  // 10. Roadmap and ask
  h1('10. Roadmap'),
  table([
    ['When', 'Milestone'],
    ['Months 1–3', 'Accounts, server-side lesson generation, database and backups, share links, MP4 video and subtitle export, billing. Closed beta.'],
    ['Months 4–6', 'Paid launch (Creator and Pro). In-lesson quizzes. Accuracy-check pass.'],
    ['Months 7–12', 'Team plans, LMS (SCORM) export, premium voices and more languages, brand themes. First team customers.'],
    ['Months 13–24', 'Learning-system integrations, single sign-on, API for education platforms. About 1,000 paying users and 20+ teams.'],
  ], [2000, 7638], { firstColBold: true }),
  h1('11. The ask'),
  p(`We propose raising **[$600,000]** in a pre-seed round. In the base case this funds about 24 months, through ${money(-cum24)} of spending, and keeps a reserve for slower growth.`),
  table([
    ['Use of funds', 'Share', 'Amount'],
    ['Product and engineering (team of 4, growing to 8)', '60%', '$360,000'],
    ['Growth: content, community, partnerships with schools', '25%', '$150,000'],
    ['Infrastructure, legal, accounting, reserve', '15%', '$90,000'],
  ], [5638, 1500, 2500]),
  spacer(),
  h1('12. Team'),
  p('[Founder names, roles and relevant background. Advisers, if any. Who builds the product, who sells to schools and companies.]'),
  pageBreak(),

  // Appendix
  h1('Appendix A. Model assumptions'),
  table([
    ['Assumption', 'Base value'],
    ['Model start', 'January 2027; paid plans from month 4'],
    ['Beta sign-ups (months 1–3)', '300, 400, 500'],
    ['Free sign-ups at paid launch', '800 a month'],
    ['Sign-up growth', '12% a month in year 1, 7% in year 2, 4% in year 3'],
    ['Free-to-paid conversion', '3% of each month’s sign-ups (and 3% of beta users at launch)'],
    ['Paid mix and average price', '75% Creator ($15), 25% Pro ($39): $21 a month'],
    ['Subscriber churn', '6% a month'],
    ['Team customers', '1 new a month from month 10, 2 from month 16, 3 from month 25, 4 from month 31; $400 a month each; 1.5% monthly churn'],
    ['Lessons per month', '15 per subscriber, 60 per team, 2 per active free user (10% of all free sign-ups active)'],
    ['Cost per lesson', '$0.40 paid, $0.05 free, all-in'],
    ['Hosting baseline', '$300, $1,000 and $2,500 a month in years 1–3'],
    ['Payment fees', '5% + $0.50 per subscription payment; 3% on team invoices'],
    ['Team', '4, 8 and 12 people; average fully loaded cost $2,500, $3,000 and $3,500 a month per person (remote team based in Nigeria)'],
    ['Marketing', '$3,000, $10,000 and $25,000 a month in years 1–3 (from month 4)'],
    ['Tools, legal and admin', '$1,500, $3,000 and $5,000 a month in years 1–3'],
    ['Conservative case', '2% conversion, 8% churn, 600 sign-ups at launch, growth 9% / 5% / 3%'],
    ['Upside case', '4.5% conversion, 5% churn, 1,000 sign-ups at launch, growth 14% / 8% / 5%'],
  ], [3400, 6238], { firstColBold: true }),
  spacer(),
  h1('Appendix B. Sources'),
  link('The Business Research Company: Corporate Training Global Market Report 2025', 'https://www.marketresearch.com/Business-Research-Company-v4006/Corporate-Training-Global-42201992'),
  link('SkyQuest: Global Corporate Training Market', 'https://www.marketresearch.com/Skyquest-Technology-Consulting-v4328/Global-Corporate-Training-41650040'),
  link('Roots Analysis: Corporate Training Market', 'https://www.rootsanalysis.com/corporate-training-market'),
  link('GII Research: Global Corporate Training Market', 'https://www.giiresearch.com/report/infi2030438-global-corporate-training-market.html'),
  link('Straits Research: AI Video Generator Market', 'https://straitsresearch.com/report/ai-video-generator-market'),
  link('Grand View Research via GII: AI Video Generator Market', 'https://www.giikorea.co.kr/report/grvi1942046-ai-video-generator-market-size-share-trends.html'),
  link('TechSci Research: AI Video Generator Market', 'https://www.techsciresearch.com/report/ai-video-generator-market/18880.html'),
  link('Sifted: Synthesia passes $100M ARR', 'https://sifted.eu/articles/synthesia-100m-arr-ai-agents'),
  link('UKTN: Synthesia $4B valuation', 'https://www.uktech.news/ai/synthesia-4bn-valuation-funding-round-reports-20251030'),
  link('Sacra: Synthesia revenue estimates', 'https://sacra.com/research/synthesia'),
  link('Ada Chen Rekhi: Freemium and free trial conversion benchmarks', 'https://medium.com/ada-chen-rekhi/freemium-and-free-trial-conversion-benchmarks-9fab38d096da'),
  link('Lago: Freemium pricing and conversion', 'https://getlago.com/blog/freemium-pricing'),
  note('Market-size figures come from commercial research firms whose definitions differ; private-company figures (Synthesia) are investor-reported, not audited.'),
]

const doc = new Document({
  creator: 'AI Theatre',
  title: 'AI Theatre: Investor Brief',
  styles: {
    default: { document: { run: { font: SANS, size: 21, color: INK } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: SERIF, size: 36, bold: true, color: INK },
        paragraph: { spacing: { before: 360, after: 180 }, keepNext: true, keepLines: true, outlineLevel: 0,
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT, space: 4 } } } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: SERIF, size: 26, bold: true, color: INK },
        paragraph: { spacing: { before: 240, after: 120 }, keepNext: true, keepLines: true, outlineLevel: 1 } },
    ],
  },
  numbering: {
    config: [{ reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 400, hanging: 260 } } } }] }],
  },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
    footers: {
      default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [
        new TextRun({ text: 'AI Theatre · Investor brief · Confidential draft   ', size: 16, color: DIM }),
        new TextRun({ children: [PageNumber.CURRENT], size: 16, color: DIM }),
      ] })] }),
    },
    children,
  }],
})

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(OUT, buffer)
  console.log('wrote', OUT, buffer.length, 'bytes')
})
