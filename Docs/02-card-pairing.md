# Checkpoint 2: Build the card list

## Goal

Let the user decide which imported sides form cards and supply one shared reverse for single-sided cards.

## Tasks

- Add an ordered list of cards. Each card has one front and either a paired imported back or the shared reverse.
- Let the user create, remove, and reorder cards; mark a card as double-sided; and choose its specific back.
- Let the user select an imported PDF page or image as the shared reverse, or create the shared reverse from a background image and an optional team logo. Provide horizontal position, vertical position, and size sliders for the logo, with a default size of roughly one third of the card width, plus rotation in 90-degree steps. Apply the chosen reverse to all single-sided cards.
- Let the user lock a selected shared reverse into a compact preview with an Edit button. Let them remove a created reverse's background from a red X at the preview's upper-right corner.
- Make source usage visible. Prevent a source side from silently being assigned to multiple distinct cards, while allowing unused source sides.
- Show a clear missing-reverse state when single-sided cards exist but the shared reverse has not been supplied.

## Acceptance criteria

- The sample can be represented as 11 cards: source pages 2 and 3 form one double-sided card, and the other ten cards use the shared reverse.
- The user can change a pairing without reimporting the PDF.
- Export readiness is blocked when a card has no front or required reverse.
- No automatic assumption pairs adjacent PDF pages.

## Dependency

Checkpoint 1.
