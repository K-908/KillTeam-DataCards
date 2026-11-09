import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { createPrintPdf } from './exportPdf'
import { importSource, renderLargePreview, type ImportResult } from './importSources'
import { backSideId, CARD_HEIGHT_MM, CARD_WIDTH_MM, getPrintLayout, makeSheets, slotPosition, type LayoutChoice, type PaperSize, type PrintLayout } from './layout'
import { createReverseDesign, type LogoRotation, type LogoSettings, type ReverseBackground } from './reverseDesign'
import type { Card, SourceFile, SourceSide } from './types'

const DESIGN_SOURCE_ID = 'created-reverse-source'
const DESIGN_SIDE_ID = 'created-reverse'
const BUILTIN_BACKGROUNDS = Object.entries(import.meta.glob<string>('./img/backgrounds/*.png', { eager: true, query: '?url', import: 'default' }))
  .sort(([first], [second]) => first.localeCompare(second))
  .map(([path, url], index) => ({ path, url, label: `Background ${index + 1}` }))

function CardSideIcon({ doubleSided }: { doubleSided: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {doubleSided && <rect x="7" y="4" width="13" height="15" rx="1.5" />}
      <rect x={doubleSided ? 4 : 5} y={doubleSided ? 7 : 4} width="13" height="15" rx="1.5" fill="white" />
      <path d={doubleSided ? 'M7 11h7M7 14h4' : 'M8 8h7M8 11h7M8 14h4'} />
    </svg>
  )
}

interface ReverseDesignResult {
  backgroundSource: ReverseBackground
  logoFile: File | null
  logoSettings: LogoSettings
  side: SourceSide
}

interface PendingSheetReview {
  name: string
  result: ImportResult
  selectedIds: Set<string>
}

interface ImportedTeamLogo {
  sourceId: string
  sourceName: string
  file: File
  previewUrl: string
}

function teamName(filename: string) {
  return filename.match(/team_rules_([^-]+)-/i)?.[1].replaceAll('_', ' ') ?? filename
}

function cardIssues(cards: Card[], sharedBackId: string | null, sources: SourceSide[], missingBackMessage: string) {
  const sourceIds = new Set(sources.map(source => source.id))
  const used = new Set<string>()
  const issues: string[] = []
  if (cards.length === 0) issues.push('Add at least one card.')
  for (const [index, card] of cards.entries()) {
    if (!sourceIds.has(card.frontId)) issues.push(`Card ${index + 1} is missing its front.`)
    if (used.has(card.frontId)) issues.push(`Card ${index + 1} reuses a source side.`)
    used.add(card.frontId)
    if (card.backMode === 'custom') {
      if (!card.backId || !sourceIds.has(card.backId)) issues.push(`Card ${index + 1} needs a second side.`)
      else {
        if (used.has(card.backId)) issues.push(`Card ${index + 1} reuses a source side.`)
        used.add(card.backId)
      }
    }
  }
  if (cards.some(card => card.backMode === 'shared') && (!sharedBackId || !sourceIds.has(sharedBackId))) {
    issues.push(missingBackMessage)
  }
  if (sharedBackId && used.has(sharedBackId)) issues.push('The shared reverse is also assigned as a card side.')
  return [...new Set(issues)]
}

interface SheetPreviewProps {
  title: string
  cards: (Card | null)[]
  face: 'front' | 'back'
  sharedBackId: string | null
  sourceById: Map<string, SourceSide>
  layout: PrintLayout
}

function SheetPreview({ title, cards, face, sharedBackId, sourceById, layout }: SheetPreviewProps) {
  return (
    <figure className="sheet-figure">
      <figcaption>{title}</figcaption>
      <div className="sheet-preview" style={{ aspectRatio: `${layout.pageWidthMm} / ${layout.pageHeightMm}` }}>
        {cards.map((card, slot) => {
          if (!card) return null
          const id = face === 'front' ? card.frontId : backSideId(card, sharedBackId)
          const side = id ? sourceById.get(id) : null
          const { x, yFromTop } = slotPosition(layout, slot)
          return (
            <div
              className="sheet-card"
              key={`${card.id}-${slot}`}
              style={{
                left: `${x / layout.pageWidthMm * 100}%`,
                top: `${yFromTop / layout.pageHeightMm * 100}%`,
                width: `${layout.slotWidthMm / layout.pageWidthMm * 100}%`,
                height: `${layout.slotHeightMm / layout.pageHeightMm * 100}%`,
              }}
              title={side?.label ?? 'Reverse not selected'}
            >
              {side ? <img
                src={side.thumbnailUrl}
                alt={side.label}
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  width: `${CARD_WIDTH_MM / layout.slotWidthMm * 100}%`,
                  height: `${CARD_HEIGHT_MM / layout.slotHeightMm * 100}%`,
                  transform: `translate(-50%, -50%) rotate(${-layout.cardRotationDegrees}deg)`,
                }}
              /> : <span>Reverse needed</span>}
            </div>
          )
        })}
      </div>
    </figure>
  )
}

interface SharedReversePreviewProps {
  side: SourceSide
  onEnlarge: () => void
  onRemoveBackground?: () => void
  removeDisabled?: boolean
  onEdit?: () => void
}

function SharedReversePreview({ side, onEnlarge, onRemoveBackground, removeDisabled, onEdit }: SharedReversePreviewProps) {
  return (
    <div className="shared-reverse-preview">
      <button type="button" className="source-preview-button" onClick={onEnlarge} aria-label="Enlarge shared reverse">
        <img src={side.thumbnailUrl} alt={side.label} />
      </button>
      {onRemoveBackground && <button type="button" className="source-delete-button" onClick={onRemoveBackground} disabled={removeDisabled} aria-label="Remove created reverse background" title="Remove created reverse background">×</button>}
      {onEdit && <button type="button" className="reverse-edit-button" onClick={onEdit}>Edit</button>}
    </div>
  )
}

export default function App() {
  const [sources, setSources] = useState<SourceSide[]>([])
  const [cards, setCards] = useState<Card[]>([])
  const [reverseChoice, setReverseChoice] = useState<'uploaded' | 'created'>('uploaded')
  const [reverseLocked, setReverseLocked] = useState(false)
  const [uploadedBackId, setUploadedBackId] = useState<string | null>(null)
  const [backgroundMode, setBackgroundMode] = useState<'upload' | 'builtin' | 'color'>('upload')
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null)
  const [builtinBackgroundUrl, setBuiltinBackgroundUrl] = useState<string | null>(BUILTIN_BACKGROUNDS[0]?.url ?? null)
  const [backgroundColor, setBackgroundColor] = useState('#263e60')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoSettings, setLogoSettings] = useState<LogoSettings>({ horizontal: 50, vertical: 50, size: 100, rotation: 0, color: null })
  const [designResult, setDesignResult] = useState<ReverseDesignResult | null>(null)
  const [designBusy, setDesignBusy] = useState(false)
  const [designError, setDesignError] = useState('')
  const [paperSize, setPaperSize] = useState<PaperSize>('a4')
  const [layoutChoice, setLayoutChoice] = useState<LayoutChoice>('vertical')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [sheetReviews, setSheetReviews] = useState<PendingSheetReview[]>([])
  const [extractedLogos, setExtractedLogos] = useState<ImportedTeamLogo[]>([])
  const [previewSide, setPreviewSide] = useState<SourceSide | null>(null)
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [pairingFrontId, setPairingFrontId] = useState<string | null>(null)
  const files = useRef(new Map<string, SourceFile>())
  const input = useRef<HTMLInputElement>(null)
  const backgroundInput = useRef<HTMLInputElement>(null)
  const logoInput = useRef<HTMLInputElement>(null)
  const previewDialog = useRef<HTMLDialogElement>(null)

  const backgroundSource = useMemo<ReverseBackground | null>(() => {
    if (backgroundMode === 'upload') return backgroundFile ? { kind: 'upload', file: backgroundFile } : null
    if (backgroundMode === 'builtin') return builtinBackgroundUrl ? { kind: 'builtin', url: builtinBackgroundUrl } : null
    return { kind: 'color', color: backgroundColor }
  }, [backgroundMode, backgroundFile, builtinBackgroundUrl, backgroundColor])
  const designedSide = designResult
    && designResult.backgroundSource === backgroundSource
    && designResult.logoFile === logoFile
    && designResult.logoSettings === logoSettings
    ? designResult.side : null
  const allSides = useMemo(() => designedSide ? [...sources, designedSide] : sources, [sources, designedSide])
  const sourceById = useMemo(() => new Map(allSides.map(source => [source.id, source])), [allSides])
  const sharedBackId = reverseChoice === 'uploaded' ? uploadedBackId : designedSide?.id ?? null
  const lockedSide = reverseLocked && sharedBackId ? sourceById.get(sharedBackId) : null
  const used = useMemo(() => {
    const result = new Set<string>()
    for (const card of cards) {
      result.add(card.frontId)
      if (card.backMode === 'custom' && card.backId) result.add(card.backId)
    }
    if (sharedBackId) result.add(sharedBackId)
    return result
  }, [cards, sharedBackId])
  const printLayout = useMemo(() => getPrintLayout(paperSize, layoutChoice), [paperSize, layoutChoice])
  const activeReview = sheetReviews[0]
  const sheets = useMemo(() => makeSheets(cards, printLayout), [cards, printLayout])
  const paperLabel = paperSize === 'a4' ? 'A4' : 'US Letter'
  const missingBackMessage = reverseChoice === 'created'
    ? backgroundSource ? designError || 'Wait for the created reverse to finish.' : 'Choose a background for the shared reverse.'
    : 'Choose the shared reverse for single-sided cards.'
  const issues = useMemo(() => cardIssues(cards, sharedBackId, allSides, missingBackMessage), [cards, sharedBackId, allSides, missingBackMessage])

  useEffect(() => {
    if (reverseLocked && !sharedBackId) setReverseLocked(false)
  }, [reverseLocked, sharedBackId])

  useEffect(() => {
    if (pairingFrontId && (used.has(pairingFrontId) || !sources.some(side => side.id === pairingFrontId) || !sources.some(side => side.id !== pairingFrontId && !used.has(side.id)))) {
      setPairingFrontId(null)
    }
  }, [pairingFrontId, sources, used])

  useEffect(() => {
    files.current.delete(DESIGN_SOURCE_ID)
    if (!backgroundSource) {
      setDesignBusy(false)
      setDesignError('')
      return
    }
    let cancelled = false
    setDesignBusy(true)
    setDesignError('')
    const timer = window.setTimeout(() => {
      void createReverseDesign(backgroundSource, logoFile, logoSettings)
        .then(result => {
          if (cancelled) return
          files.current.set(DESIGN_SOURCE_ID, { kind: 'image', bytes: result.bytes })
          setDesignResult({
            backgroundSource,
            logoFile,
            logoSettings,
            side: {
              id: DESIGN_SIDE_ID,
              sourceId: DESIGN_SOURCE_ID,
              kind: 'image',
              label: 'Created shared reverse',
              thumbnailUrl: result.thumbnailUrl,
              width: result.width,
              height: result.height,
            },
          })
          setDesignBusy(false)
        })
        .catch(error => {
          if (cancelled) return
          setDesignError(`Reverse design failed: ${error instanceof Error ? error.message : String(error)}`)
          setDesignBusy(false)
        })
    }, 120)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [backgroundSource, logoFile, logoSettings])

  useEffect(() => {
    const dialog = previewDialog.current
    if (!dialog) return
    if (previewSide && !dialog.open) dialog.showModal()
    if (!previewSide && dialog.open) dialog.close()
  }, [previewSide])

  useEffect(() => {
    if (!previewSide) return
    const source = files.current.get(previewSide.sourceId)
    if (!source) return
    let cancelled = false
    void renderLargePreview(previewSide, source)
      .then(url => { if (!cancelled) setPreviewImageUrl(url) })
      .catch(error => {
        if (!cancelled) setPreviewError(`Full-size preview unavailable: ${error instanceof Error ? error.message : String(error)}`)
      })
    return () => { cancelled = true }
  }, [previewSide])

  async function addFiles(incoming: FileList | File[]) {
    if (!incoming.length) return
    setBusy(true)
    setMessage('Importing files…')
    const errors: string[] = []
    let importedSides = 0
    let sheetsToReview = 0
    try {
      for (const file of Array.from(incoming)) {
        try {
          const result = await importSource(file)
          files.current.set(result.sides[0].sourceId, result.file)
          if (result.sheetInfo) {
            setSheetReviews(previous => [...previous, {
              name: file.name,
              result,
              selectedIds: new Set(result.sides.filter(side => !side.suggestedNote).map(side => side.id)),
            }])
            sheetsToReview++
          } else {
            setSources(previous => [...previous, ...result.sides])
            importedSides += result.sides.length
          }
        } catch (error) {
          errors.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      setMessage([
        importedSides ? `Imported ${importedSides} side${importedSides === 1 ? '' : 's'}.` : '',
        sheetsToReview ? `${sheetsToReview} sheet PDF${sheetsToReview === 1 ? '' : 's'} ready for review.` : '',
        ...errors,
      ].filter(Boolean).join(' '))
    } finally {
      setBusy(false)
    }
  }

  function updateReviewSelection(ids: Set<string>) {
    setSheetReviews(previous => previous.map((review, index) => index === 0 ? { ...review, selectedIds: ids } : review))
  }

  function confirmSheetReview() {
    if (!activeReview || activeReview.selectedIds.size === 0) return
    const selected = activeReview.result.sides.filter(side => activeReview.selectedIds.has(side.id))
    setSources(previous => [...previous, ...selected])
    if (activeReview.result.extractedLogo) {
      const { file, previewUrl } = activeReview.result.extractedLogo
      setExtractedLogos(previous => [...previous, {
        sourceId: selected[0].sourceId,
        sourceName: activeReview.name,
        file,
        previewUrl,
      }])
    }
    setSheetReviews(previous => previous.slice(1))
    setMessage(`Imported ${selected.length} card side${selected.length === 1 ? '' : 's'} from ${activeReview.name}.`)
  }

  function discardSheetReview() {
    if (!activeReview) return
    files.current.delete(activeReview.result.sides[0].sourceId)
    if (previewSide?.sourceId === activeReview.result.sides[0].sourceId) setPreviewSide(null)
    setSheetReviews(previous => previous.slice(1))
    setMessage(`Skipped ${activeReview.name}.`)
  }

  function onInputChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) void addFiles(event.target.files)
    event.target.value = ''
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    if (!busy) void addFiles(event.dataTransfer.files)
  }

  function addCard(frontId: string, backMode: Card['backMode'] = 'shared', backId: string | null = null) {
    if (busy || used.has(frontId) || (backMode === 'custom' && (!backId || used.has(backId) || backId === frontId))) return
    setCards(previous => [...previous, {
      id: crypto.randomUUID(),
      frontId,
      backMode,
      backId,
    }])
    setPairingFrontId(null)
  }

  function deleteSourceSide(side: SourceSide) {
    if (busy) return
    if (pairingFrontId === side.id) setPairingFrontId(null)
    const remaining = sources.filter(source => source.id !== side.id)
    setSources(remaining)
    if (!remaining.some(source => source.sourceId === side.sourceId)) {
      files.current.delete(side.sourceId)
    }
    setCards(previous => previous
      .filter(card => card.frontId !== side.id)
      .map(card => card.backId === side.id ? { ...card, backId: null } : card))
    setUploadedBackId(previous => previous === side.id ? null : previous)
    if (previewSide?.id === side.id) setPreviewSide(null)
    setMessage(`Deleted ${side.label}. Any card using it was updated.`)
  }

  function openSourcePreview(side: SourceSide) {
    setPreviewImageUrl(null)
    setPreviewError('')
    setPreviewSide(side)
  }

  function removeBackground() {
    if (busy) return
    setBackgroundMode('upload')
    setBackgroundFile(null)
    setReverseLocked(false)
    if (previewSide?.id === DESIGN_SIDE_ID) setPreviewSide(null)
  }

  function moveCard(index: number, direction: number) {
    const target = index + direction
    if (target < 0 || target >= cards.length) return
    setCards(previous => {
      const next = [...previous]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  async function downloadPdf() {
    if (issues.length || busy) return
    setBusy(true)
    setMessage('Building print PDF…')
    try {
      const data = await createPrintPdf(cards, sharedBackId, allSides, files.current, printLayout)
      const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: 'application/pdf' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `kill-team-data-cards-${paperSize}-${printLayout.orientation}-${printLayout.rows}x${printLayout.columns}-duplex.pdf`
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
      setMessage(`Downloaded ${sheets.length * 2}-page PDF.`)
    } catch (error) {
      setMessage(`Export failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Kill Team Data Cards</h1>
        <p>Arrange your card files into sheets for double-sided printing.</p>
      </header>

      <main>
        <section className="panel" aria-labelledby="import-heading">
          <div className="section-heading">
            <div><span className="step">1</span><h2 id="import-heading">Import card sides</h2></div>
            <span>{sources.length} sides</span>
          </div>
          <div className="drop-zone" onDragOver={event => event.preventDefault()} onDrop={onDrop}>
            <input ref={input} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" onChange={onInputChange} hidden />
            <button type="button" onClick={() => input.current?.click()} disabled={busy}>Choose PDF or images</button>
            <span>or drop files here. Single-card pages import directly; card sheets are split for review.</span>
          </div>
          <p className="source-hint">Need card PDFs? <a href="https://www.warhammer-community.com/en-gb/downloads/kill-team/" target="_blank" rel="noopener noreferrer">Download team sheets from Warhammer Community</a> or <a href="https://www.reddit.com/r/killteam/comments/1fue0wb/all_kill_team_pdf_links_from_the_app/" target="_blank" rel="noopener noreferrer">find one-card-per-page PDFs in this Reddit list</a>, then upload the PDF here.</p>
          <p className="source-hint">Click a card image to read it at a larger size, or to select a reverse while pairing. Deleting an assigned front removes its card; deleting a reverse clears that selection.</p>
          {message && <p className="message" role="status">{message}</p>}
          {activeReview && <section className="sheet-review" aria-labelledby="sheet-review-heading">
            <div className="sheet-review-heading">
              <div>
                <h3 id="sheet-review-heading">Review detected cards</h3>
                <p>{activeReview.name} · {activeReview.result.sides.length} regions on {activeReview.result.sheetInfo?.detectedPages} of {activeReview.result.sheetInfo?.pageCount} pages. Pages without a card grid are skipped.</p>
              </div>
              {sheetReviews.length > 1 && <span>{sheetReviews.length - 1} more to review</span>}
            </div>
            <p>Card-sized outlines located these regions. Notes are unchecked by default. Select the sides you want to import; you can pair fronts and backs afterward.</p>
            {activeReview.result.extractedLogo && <div className="detected-logo">
              <img src={activeReview.result.extractedLogo.previewUrl} alt={`Extracted ${teamName(activeReview.name)} logo`} />
              <span>Orange team logo found on page 1. After importing, you can use it in a created shared reverse.</span>
            </div>}
            <div className="review-actions">
              <button type="button" onClick={() => updateReviewSelection(new Set(activeReview.result.sides.map(side => side.id)))}>Select all</button>
              <button type="button" onClick={() => updateReviewSelection(new Set(activeReview.result.sides.filter(side => !side.suggestedNote).map(side => side.id)))}>Exclude Notes</button>
            </div>
            <div className="review-grid">
              {activeReview.result.sides.map(side => <article className="review-tile" key={side.id}>
                <button type="button" className="source-preview-button" onClick={() => openSourcePreview(side)} aria-label={`Enlarge ${side.label}`}>
                  <img src={side.thumbnailUrl} alt="" />
                </button>
                <label>
                  <input type="checkbox" checked={activeReview.selectedIds.has(side.id)} onChange={event => {
                    const next = new Set(activeReview.selectedIds)
                    if (event.target.checked) next.add(side.id)
                    else next.delete(side.id)
                    updateReviewSelection(next)
                  }} />
                  <span>Page {(side.pageIndex ?? 0) + 1} · card {(side.cardIndex ?? 0) + 1}{side.suggestedNote ? ' · Notes' : ''}</span>
                </label>
              </article>)}
            </div>
            <div className="review-actions review-confirm">
              <button type="button" className="primary" onClick={confirmSheetReview} disabled={busy || activeReview.selectedIds.size === 0}>Import {activeReview.selectedIds.size} selected sides</button>
              <button type="button" onClick={discardSheetReview} disabled={busy}>Skip this PDF</button>
            </div>
          </section>}
          {pairingFrontId && !used.has(pairingFrontId) && <p className="pairing-prompt" role="status">Choose the reverse for {sourceById.get(pairingFrontId)?.label} by clicking an unused card thumbnail, or use its “Select reverse” button.</p>}
          {sources.length > 0 && (
            <div className="source-grid">
              {sources.map(side => {
                const assigned = used.has(side.id)
                const assignedDuringPairing = pairingFrontId !== null && assigned
                const isPairingFront = pairingFrontId === side.id && !assigned
                const canSelectReverse = pairingFrontId !== null && !isPairingFront && !assigned && !busy
                const availableBack = sources.some(candidate => candidate.id !== side.id && !used.has(candidate.id))
                return (
                  <article className={`source-tile${isPairingFront ? ' pairing-front' : ''}${canSelectReverse ? ' reverse-candidate' : ''}${assignedDuringPairing ? ' assigned-during-pairing' : ''}`} key={side.id}>
                    <div className="source-image-wrap">
                      <button type="button" className="source-preview-button" onClick={() => canSelectReverse ? addCard(pairingFrontId, 'custom', side.id) : openSourcePreview(side)} disabled={assignedDuringPairing} aria-label={canSelectReverse ? `Select ${side.label} as reverse` : `Enlarge ${side.label}`} title={assignedDuringPairing ? 'Already assigned' : canSelectReverse ? 'Select reverse' : 'Enlarge card'}>
                        <img src={side.thumbnailUrl} alt="" />
                      </button>
                      <button type="button" className="source-delete-button" onClick={() => deleteSourceSide(side)} disabled={busy || assignedDuringPairing} aria-label={`Delete ${side.label}`} title={`Delete ${side.label}`}>×</button>
                    </div>
                    {side.autoRotated && <span className="rotation-tag">Rotated 90° CCW</span>}
                    <div className="source-tile-footer">
                      <span title={side.label}>{side.label}</span>
                      <div className="source-card-actions">
                        {isPairingFront ? (
                          <button type="button" className="cancel-pairing-button" onClick={() => setPairingFrontId(null)}>Cancel</button>
                        ) : canSelectReverse ? (
                          <button type="button" className="select-reverse-button" onClick={() => addCard(pairingFrontId, 'custom', side.id)}>Select reverse</button>
                        ) : (
                          <>
                            <button type="button" className="side-icon-button" onClick={() => addCard(side.id)} disabled={assigned || busy} aria-label={`Add ${side.label} as a one-sided card`} title="One-sided card">
                              <CardSideIcon doubleSided={false} />
                            </button>
                            <button type="button" className="side-icon-button" onClick={() => setPairingFrontId(side.id)} disabled={assigned || busy || !availableBack} aria-label={`Add ${side.label} as a two-sided card`} title={availableBack ? 'Two-sided card' : 'Import another unused side to pair'}>
                              <CardSideIcon doubleSided />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {assigned && <span className="source-assigned">Assigned</span>}
                    {isPairingFront && <span className="source-pairing-label">Choose its reverse from the highlighted cards.</span>}
                  </article>
                )
              })}
            </div>
          )}
        </section>

        <section className="panel" aria-labelledby="cards-heading">
          <div className="section-heading">
            <div><span className="step">2</span><h2 id="cards-heading">Set fronts and backs</h2></div>
            <span>{cards.length} cards</span>
          </div>
          <p className="hint">Use the one-sided or two-sided icon on an imported card. For a two-sided card, click an unused card thumbnail or its “Select reverse” button. Outside pairing, click a card image to enlarge it. One-sided cards use the shared reverse.</p>
          {lockedSide ? (
            <div className="locked-reverse">
              <strong>Shared reverse</strong>
              <SharedReversePreview
                side={lockedSide}
                onEnlarge={() => openSourcePreview(lockedSide)}
                onRemoveBackground={reverseChoice === 'created' ? removeBackground : undefined}
                removeDisabled={busy}
                onEdit={() => setReverseLocked(false)}
              />
            </div>
          ) : (
          <>
          <fieldset className="reverse-choice">
            <legend>Shared reverse for single-sided cards</legend>
            <label><input type="radio" name="reverse-choice" checked={reverseChoice === 'uploaded'} onChange={() => setReverseChoice('uploaded')} /> Use an uploaded card side</label>
            <label><input type="radio" name="reverse-choice" checked={reverseChoice === 'created'} onChange={() => setReverseChoice('created')} /> Design a reverse</label>
          </fieldset>
          {reverseChoice === 'uploaded' ? (
            <>
              <label className="shared-select">
                <span>Uploaded reverse</span>
                <select value={uploadedBackId ?? ''} onChange={event => setUploadedBackId(event.target.value || null)}>
                  <option value="">Choose a page or image…</option>
                  {sources.filter(side => !used.has(side.id) || side.id === uploadedBackId).map(side => (
                    <option key={side.id} value={side.id}>{side.label}</option>
                  ))}
                </select>
              </label>
              {uploadedBackId && sourceById.has(uploadedBackId) && (
                <SharedReversePreview side={sourceById.get(uploadedBackId)!} onEnlarge={() => openSourcePreview(sourceById.get(uploadedBackId)!)} />
              )}
            </>
          ) : (
            <div className="reverse-designer">
              <fieldset className="background-mode">
                <legend>Background</legend>
                <label><input type="radio" name="background-mode" checked={backgroundMode === 'upload'} onChange={() => setBackgroundMode('upload')} /> Upload image</label>
                <label><input type="radio" name="background-mode" checked={backgroundMode === 'builtin'} onChange={() => setBackgroundMode('builtin')} disabled={BUILTIN_BACKGROUNDS.length === 0} /> Included backgrounds</label>
                <label><input type="radio" name="background-mode" checked={backgroundMode === 'color'} onChange={() => setBackgroundMode('color')} /> Solid color</label>
              </fieldset>
              <div className="design-files">
                {backgroundMode === 'upload' && <div className="design-file-field">
                  <span>Uploaded background</span>
                  <input ref={backgroundInput} type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" onChange={event => {
                    if (event.target.files?.[0]) setBackgroundFile(event.target.files[0])
                    event.target.value = ''
                  }} hidden />
                  <button type="button" onClick={() => backgroundInput.current?.click()}>Choose background image</button>
                  <small title={backgroundFile?.name}>{backgroundFile?.name ?? 'No image selected'}</small>
                </div>}
                <div className="design-file-field">
                  <span>Team logo (optional)</span>
                  <input ref={logoInput} type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" onChange={event => {
                    if (event.target.files?.[0]) setLogoFile(event.target.files[0])
                    event.target.value = ''
                  }} hidden />
                  <button type="button" onClick={() => logoInput.current?.click()}>Choose team logo</button>
                  <small title={logoFile?.name}>{logoFile?.name ?? 'No logo selected'}</small>
                </div>
                {logoFile && <button type="button" onClick={() => {
                  setLogoFile(null)
                }}>Remove logo</button>}
              </div>
              {backgroundMode === 'builtin' && <div className="background-gallery" role="group" aria-label="Included backgrounds">
                {BUILTIN_BACKGROUNDS.map(background => <button type="button" key={background.path} className={builtinBackgroundUrl === background.url ? 'background-choice selected' : 'background-choice'} onClick={() => setBuiltinBackgroundUrl(background.url)} aria-pressed={builtinBackgroundUrl === background.url} aria-label={`Use ${background.label}`}>
                  <img src={background.url} alt="" loading="lazy" />
                  <span>{background.label}</span>
                </button>)}
              </div>}
              {backgroundMode === 'color' && <label className="background-color-field">
                <span>Background color</span>
                <input type="color" value={backgroundColor} onChange={event => setBackgroundColor(event.target.value)} />
                <output>{backgroundColor.toUpperCase()}</output>
              </label>}
              {extractedLogos.length > 0 && <div className="extracted-logos">
                <strong>Logos found in imported team PDFs</strong>
                <div className="extracted-logo-list">
                  {extractedLogos.map(logo => <button type="button" key={logo.sourceId} className={logoFile === logo.file ? 'extracted-logo-choice selected' : 'extracted-logo-choice'} onClick={() => setLogoFile(logo.file)} aria-label={`Use ${teamName(logo.sourceName)} logo`}>
                    <img src={logo.previewUrl} alt="" />
                    <span>{teamName(logo.sourceName)}</span>
                  </button>)}
                </div>
                <small>The orange pixels were extracted locally as a transparent PNG. Select one to use it as the team logo.</small>
              </div>}
              <div className="design-options">
                <label className="design-slider">
                  <span>Horizontal position: <output>{logoSettings.horizontal}%</output></span>
                  <input type="range" min="0" max="100" value={logoSettings.horizontal} onChange={event => setLogoSettings(previous => ({ ...previous, horizontal: Number(event.target.value) }))} disabled={!logoFile} aria-label="Horizontal position" />
                  <span className="range-ends"><span>Left</span><span>Right</span></span>
                </label>
                <label className="design-slider">
                  <span>Vertical position: <output>{logoSettings.vertical}%</output></span>
                  <input type="range" min="0" max="100" value={logoSettings.vertical} onChange={event => setLogoSettings(previous => ({ ...previous, vertical: Number(event.target.value) }))} disabled={!logoFile} aria-label="Vertical position" />
                  <span className="range-ends"><span>Top</span><span>Bottom</span></span>
                </label>
                <label className="design-slider">
                  <span>Logo size: <output>{logoSettings.size}%</output></span>
                  <input type="range" min="25" max="200" step="5" value={logoSettings.size} onChange={event => setLogoSettings(previous => ({ ...previous, size: Number(event.target.value) }))} disabled={!logoFile} aria-label="Logo size" />
                  <span className="range-ends"><span>Smaller</span><span>Larger</span></span>
                </label>
                <label>
                  <span>Logo rotation</span>
                  <select value={logoSettings.rotation} onChange={event => setLogoSettings(previous => ({ ...previous, rotation: Number(event.target.value) as LogoRotation }))} disabled={!logoFile}>
                    <option value={0}>0°</option>
                    <option value={90}>90° clockwise</option>
                    <option value={180}>180°</option>
                    <option value={270}>90° counter-clockwise</option>
                  </select>
                </label>
                <label className="logo-color-field">
                  <span>Logo color</span>
                  <span className="logo-color-value">
                    <input type="color" value={logoSettings.color ?? '#ef6a28'} onChange={event => setLogoSettings(previous => ({ ...previous, color: event.target.value }))} disabled={!logoFile} aria-label="Logo color" />
                    <output>{logoSettings.color?.toUpperCase() ?? 'Original colors'}</output>
                  </span>
                </label>
                {logoFile && logoSettings.color && <button type="button" className="logo-original-button" onClick={() => setLogoSettings(previous => ({ ...previous, color: null }))}>Use original colors</button>}
              </div>
              <p className="design-hint">Image backgrounds fill the card without stretching. At 100% size, the logo occupies about one third of the card width. Position sliders keep it within the card. Choosing a logo color replaces its visible colors while keeping its transparency.</p>
              {designBusy && <p role="status">Building reverse preview…</p>}
              {designError && <p className="preview-error" role="alert">{designError}</p>}
              {designedSide && <SharedReversePreview side={designedSide} onEnlarge={() => openSourcePreview(designedSide)} onRemoveBackground={removeBackground} removeDisabled={busy} />}
            </div>
          )}
          <button type="button" className="lock-reverse-button" onClick={() => setReverseLocked(true)} disabled={!sharedBackId || designBusy || busy}>Lock reverse</button>
          </>
          )}

          {cards.length === 0 ? <p className="empty-state">No cards yet. Choose the one-sided or two-sided icon on a source thumbnail.</p> : (
            <div className="card-list">
              {cards.map((card, index) => {
                const front = sourceById.get(card.frontId)
                const back = card.backMode === 'custom' && card.backId ? sourceById.get(card.backId) : null
                return (
                  <article className="card-row" key={card.id}>
                    <span className="card-number">{index + 1}</span>
                    {front && <button type="button" className="card-thumb-button" onClick={() => openSourcePreview(front)} aria-label={`Enlarge front of card ${index + 1}`} title={front.label}>
                      <img className="card-thumb" src={front.thumbnailUrl} alt="" />
                      <span className="card-thumb-label">Front</span>
                    </button>}
                    {back && <button type="button" className="card-thumb-button" onClick={() => openSourcePreview(back)} aria-label={`Enlarge back of card ${index + 1}`} title={back.label}>
                      <img className="card-thumb" src={back.thumbnailUrl} alt="" />
                      <span className="card-thumb-label">Back</span>
                    </button>}
                    <div className="card-details">
                      <strong title={front?.label}>{front?.label ?? 'Missing front'}</strong>
                      <span className="card-type">{card.backMode === 'custom' ? 'Two-sided card' : 'One-sided card · shared reverse'}</span>
                      {card.backMode === 'custom' && !back && <span className="card-missing-back">Reverse missing. Remove this card and pair it again.</span>}
                    </div>
                    <div className="row-actions">
                      <button type="button" onClick={() => moveCard(index, -1)} disabled={index === 0} aria-label={`Move card ${index + 1} up`}>↑</button>
                      <button type="button" onClick={() => moveCard(index, 1)} disabled={index === cards.length - 1} aria-label={`Move card ${index + 1} down`}>↓</button>
                      <button type="button" onClick={() => setCards(previous => previous.filter(item => item.id !== card.id))}>Remove</button>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>

        <section className="panel" aria-labelledby="preview-heading">
          <div className="section-heading">
            <div><span className="step">3</span><h2 id="preview-heading">Preview sheets</h2></div>
            <span>{sheets.length} sheets · {sheets.length * 2} PDF pages</span>
          </div>
          <div className="layout-controls">
            <label>
              <span>Paper size</span>
              <select value={paperSize} onChange={event => setPaperSize(event.target.value as PaperSize)}>
                <option value="a4">A4</option>
                <option value="letter">US Letter</option>
              </select>
            </label>
            <label>
              <span>Card layout</span>
              <select value={layoutChoice} onChange={event => setLayoutChoice(event.target.value as LayoutChoice)}>
                <option value="vertical">{paperSize === 'a4' ? '4 × 1 (vertical)' : '3 × 1 (vertical)'}</option>
                <option value="grid">2 × 2</option>
              </select>
            </label>
          </div>
          <p className="hint">{paperLabel} {printLayout.orientation} · {printLayout.cardsPerSheet} cards per sheet · 121 × 70 mm cards · {printLayout.gapMm} mm gaps. {printLayout.choice === 'grid' ? 'Cards are turned sideways. Reverse columns swap left and right for long-edge duplex printing.' : 'Reverses keep the same top-to-bottom order for long-edge duplex printing.'}</p>
          {paperSize === 'letter' && layoutChoice === 'vertical' && <p className="hint">US Letter fits three full-size cards vertically. The fourth card starts a new sheet.</p>}
          {sheets.length === 0 ? <p className="empty-state">Add cards to see the sheet layout.</p> : (
            <div className="sheet-list">
              {sheets.map((sheet, index) => (
                <div className="sheet-pair" key={index}>
                  <SheetPreview title={`Sheet ${index + 1} · front`} cards={sheet.fronts} face="front" sharedBackId={sharedBackId} sourceById={sourceById} layout={printLayout} />
                  <SheetPreview title={`Sheet ${index + 1} · reverse`} cards={sheet.backs} face="back" sharedBackId={sharedBackId} sourceById={sourceById} layout={printLayout} />
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel export-panel" aria-labelledby="export-heading">
          <div className="section-heading">
            <div><span className="step">4</span><h2 id="export-heading">Export print PDF</h2></div>
          </div>
          {issues.length > 0 && <ul className="issues">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
          <p>Print {paperLabel} {printLayout.orientation}, double-sided, <strong>flip on {printLayout.flipEdge} edge</strong>, at <strong>actual size / 100%</strong>. The PDF alternates front and reverse sheets.</p>
          <button type="button" className="primary" onClick={() => void downloadPdf()} disabled={issues.length > 0 || busy}>Download PDF</button>
        </section>
      </main>
      <dialog ref={previewDialog} className="card-preview-dialog" aria-label={previewSide ? `Preview of ${previewSide.label}` : 'Card preview'} onClose={() => {
        setPreviewSide(null)
        setPreviewImageUrl(null)
        setPreviewError('')
      }} onClick={event => {
        if (event.target === event.currentTarget) previewDialog.current?.close()
      }}>
        {previewSide && (
          <div className="card-preview-content">
            <div className="card-preview-header">
              <strong>{previewSide.label}</strong>
              <button type="button" onClick={() => previewDialog.current?.close()} aria-label="Close preview">Close</button>
            </div>
            <img src={previewImageUrl ?? previewSide.thumbnailUrl} alt={previewSide.label} />
            {previewError && <p className="preview-error">{previewError}</p>}
          </div>
        )}
      </dialog>
    </div>
  )
}
