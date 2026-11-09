# Checkpoint 4: Preview, export, and verify

## Goal

Give the user a final preview and a downloadable PDF ready for duplex printing.

## Tasks

- Show each front sheet beside its matching reverse sheet, with card labels available in the UI for checking pairings.
- Export a PDF with pages ordered front 1, reverse 1, front 2, reverse 2, and so on.
- Use pdf-lib to place source PDF pages directly when possible so export does not lose their original quality. Embed imported images at sufficient resolution without changing their aspect ratio.
- Render the created shared reverse at print resolution and use that same composition in the reverse preview and exported PDF.
- Apply the recorded 90-degree counter-clockwise rotation to portrait PDF pages in the exported PDF; the preview and export must agree.
- Show the selected A4 or US Letter size, portrait orientation, long-edge duplex flip, and actual size / 100% scale. Rotate cards within portrait 2 x 2 sheets in both preview and export.
- Verify the generated PDF's page count, dimensions, card positions, and front/reverse mapping using the sample PDF and a supplied shared reverse.
- Document local build and use in the README. Confirm the production build works as a static front-end app with a GitHub Pages-compatible base path.

## Acceptance criteria

- The sample's 11 cards export as six pages for A4 vertical or either 2 x 2 layout, and eight pages for Letter vertical.
- Every card has its intended reverse in the correct physical position, and the unused final slot is blank on both sides.
- The output page dimensions, card count, gap, and duplex mapping match the selected paper and layout. Cards measure 121 x 70 mm; 2 x 2 slots measure 70 x 121 mm after rotation.
- The preview matches the exported PDF, and the local production build succeeds.

## Dependency

Checkpoint 3.
