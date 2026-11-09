# Kill Team Data Cards

## Project purpose

Build a small app that turns user-supplied Kill Team data cards into print-ready, double-sided PDF sheets. The user runs it locally on one computer. The app should remain a front-end-only static site so it could also be hosted on GitHub Pages later. The app does not search Reddit or download card artwork.

## Agreed workflow

1. The user imports a PDF or image files. In the sample PDF, each page is one card side. Show every imported page or image as a thumbnail.
2. The user manually selects card fronts. A card can be marked double-sided and paired with a specific imported page or image for its back.
3. The user chooses one shared reverse from an uploaded card side or creates one from a background image and an optional team logo. Sliders move the logo horizontally and vertically and adjust its size; the default size is about one third of the card width. The logo can rotate in 90-degree steps. The user can lock the selected reverse to collapse its controls, edit it to expand them again, and remove a created reverse's background with a red X on its preview. Apply the selected reverse to every single-sided card. Do not require a separate reverse for each such card.
4. The user selects A4 or US Letter paper and a vertical or 2 x 2 layout, reviews the card list and front/reverse sheet preview, then downloads a print-ready PDF.

Do not infer that adjacent source pages form a double-sided card. The user must be able to choose the pairing. Allow imported pages to remain unused.

## Sample and print specification

- The provided example PDF has 12 pages. Every page is exactly 121 x 70 mm. Pages 2 and 3 are the two sides of one card; the other ten pages are single-sided. That makes 11 physical cards when all pages are used.
- Use fixed 121 x 70 mm cards. In the 2 x 2 layout, rotate each card 90 degrees inside a 70 x 121 mm slot on portrait paper. Preserve source proportions without stretching. Keep imported PDF pages as PDF content in the exported document when feasible, rather than rasterizing them for export.
- Build a created shared reverse locally in the browser from user-provided images. Fill the card with the background without stretching it and place the optional logo at the selected horizontal and vertical position and size. Keep the preview and PDF output consistent.
- If an imported PDF page is taller than it is wide in its displayed orientation, rotate that page 90 degrees counter-clockwise in both the preview and PDF export. Leave landscape PDF pages and imported images as they are.
- Default to A4 portrait (210 x 297 mm), four cards in one centered column with 2 mm gaps. This gives 44.5 mm side margins and 5.5 mm top/bottom margins.
- Offer US Letter (215.9 x 279.4 mm) as an alternative paper size and 2 x 2 as an alternative layout. The vertical option becomes 3 x 1 with 6 mm gaps on Letter because four full-size cards cannot fit. The 2 x 2 option uses portrait paper with 6 mm gaps and four rotated cards on either paper size.
- Generate front and reverse sheets in alternating order for duplex printing. Vertical layouts keep backs in top-to-bottom order. The 2 x 2 layout swaps back columns. Both use **flip on long edge**. Blank slots on the final front sheet have blank matching slots on its reverse.
- Include a visible sheet preview and unobtrusive cutting guides. State that printing should use actual size / 100% scale.
- There is no print calibration feature or arbitrary card-size/layout editor in version one.

## Planned implementation

- React + TypeScript + Vite, running entirely in the browser.
- PDF.js for source PDF page thumbnails/previews.
- pdf-lib for assembling the output PDF and embedding PDF pages.
- No backend, account, remote upload, or network dependency for processing user files.
- Keep configuration compatible with a possible GitHub Pages deployment. Deployment is outside the initial build.

## Work plan

Implement the four checkpoints in `Docs/` in numeric order. Finish each checkpoint's acceptance criteria before moving to the next. Keep the source PDF and any other user-provided card artwork out of the repository unless explicitly requested.
