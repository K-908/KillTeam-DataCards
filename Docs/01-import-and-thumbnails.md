# Checkpoint 1: Import sources and show thumbnails

## Goal

Open user-provided card PDFs and images in a local browser session, with one selectable thumbnail per PDF page or image.

## Tasks

- Set up a React, TypeScript, and Vite app in this repository with clear local run instructions.
- Accept PDF plus common image formats (PNG, JPEG, and WebP) through a file picker and drag-and-drop if practical.
- Use PDF.js to render source PDF thumbnails. Keep the original file bytes available for later PDF export.
- Detect PDF pages whose displayed height exceeds their width and show them rotated 90 degrees counter-clockwise. Record that rotation for export.
- Give every source side a stable label such as filename and page number. Show page count and import errors clearly.
- Keep processing in the browser. Do not upload files or bundle example card artwork in the repo.

## Acceptance criteria

- The 12-page sample appears as 12 distinct, readable thumbnails in source order.
- A portrait PDF page appears landscape after its automatic counter-clockwise rotation; landscape PDF pages remain unchanged.
- Adding images alongside a PDF works in the same session.
- A bad or unsupported file reports an error without losing other imported sources.
- The app runs locally from documented commands.

## Dependency

None. This is the first checkpoint.
