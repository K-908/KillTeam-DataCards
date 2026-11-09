# Kill Team Data Cards

A local, browser-based tool for arranging user-provided Kill Team cards on double-sided A4 or US Letter print sheets. Files stay in your browser session; the app has no server or upload step.

## Run locally

Install [Node.js](https://nodejs.org/) and then run:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. For a static build, run `npm run build`; the files appear in `dist/`. The build uses relative asset paths and can also be served from a GitHub Pages project path.

## Make a print PDF

1. Import a PDF, PNG, JPEG, or WebP. Each PDF page becomes one source side.
   PDF pages that are taller than they are wide are automatically rotated 90° counter-clockwise in the preview and exported sheets.
   Click an imported thumbnail to inspect it at a larger size. Use the red **×** in its upper-right corner to remove an unwanted source side; assigned fronts are removed from the card list, while selected backs are cleared for reassignment.
2. Add each desired front to the card list. For a card with a unique second side, select **Two-sided card** and choose its back page.
3. For the **Shared reverse**, choose an uploaded card side or **Create from images**. The created option needs a background image and can add a team logo. Use the sliders to move the logo horizontally and vertically and adjust its size; rotate it in 90° steps. The background fills the card, and the logo starts at roughly one third of the card width. Click **Lock reverse** to collapse these controls, then **Edit** to reopen them. The red **×** on a created reverse removes its background. This reverse applies to all single-sided cards.
4. Reorder cards if needed, choose the paper size and layout, check the front and reverse sheet previews, and download the PDF.

The default is A4 portrait with four 121 × 70 mm cards stacked vertically. The available print settings are:

| Paper | Selected layout | Output | Gap | Duplex setting |
| --- | --- | --- | --- | --- |
| A4 | 4 × 1 | Four cards, portrait | 2 mm | Flip on long edge |
| US Letter | Vertical | Three cards (3 × 1), portrait | 6 mm | Flip on long edge |
| A4 or US Letter | 2 × 2 | Four rotated cards, portrait | 6 mm | Flip on long edge |

Four full-size cards cannot fit vertically on US Letter, so the vertical option changes to 3 × 1 when Letter is selected. Always print at **actual size / 100% scale**. PDF pages alternate front, reverse, front, reverse. Small marks at the card corners help with cutting.

The app does not save a session after a reload. Keep your source files and import them again when needed. It does not fetch card artwork or include any in the repository.

See [`Docs/`](Docs/) for the four implementation checkpoints and [`agents.md`](agents.md) for the project specification.
