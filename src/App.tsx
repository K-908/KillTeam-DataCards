import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { createPrintPdf } from './exportPdf'
import { importSource, renderLargePreview } from './importSources'
import { backSideId, CARD_HEIGHT_MM, CARD_WIDTH_MM, getPrintLayout, makeSheets, slotPosition, type LayoutChoice, type PaperSize, type PrintLayout } from './layout'
import { createReverseDesign, type LogoRotation, type LogoSettings } from './reverseDesign'
import type { Card, SourceFile, SourceSide } from './types'

const DESIGN_SOURCE_ID = 'created-reverse-source'
const DESIGN_SIDE_ID = 'created-reverse'

interface ReverseDesignResult {
  backgroundFile: File
  logoFile: File | null
  logoSettings: LogoSettings
  side: SourceSide
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
      {onRemoveBackground && <button type="button" className="source-delete-button" onClick={onRemoveBackground} disabled={removeDisabled} aria-label="Remove background image" title="Remove background image">×</button>}
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
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoSettings, setLogoSettings] = useState<LogoSettings>({ horizontal: 50, vertical: 50, size: 100, rotation: 0 })
  const [designResult, setDesignResult] = useState<ReverseDesignResult | null>(null)
  const [designBusy, setDesignBusy] = useState(false)
  const [designError, setDesignError] = useState('')
  const [paperSize, setPaperSize] = useState<PaperSize>('a4')
  const [layoutChoice, setLayoutChoice] = useState<LayoutChoice>('vertical')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [previewSide, setPreviewSide] = useState<SourceSide | null>(null)
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState('')
  const files = useRef(new Map<string, SourceFile>())
  const input = useRef<HTMLInputElement>(null)
  const backgroundInput = useRef<HTMLInputElement>(null)
  const logoInput = useRef<HTMLInputElement>(null)
  const previewDialog = useRef<HTMLDialogElement>(null)

  const designedSide = designResult
    && designResult.backgroundFile === backgroundFile
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
  const sheets = useMemo(() => makeSheets(cards, printLayout), [cards, printLayout])
  const paperLabel = paperSize === 'a4' ? 'A4' : 'US Letter'
  const missingBackMessage = reverseChoice === 'created'
    ? backgroundFile ? designError || 'Wait for the created reverse to finish.' : 'Choose a background image for the shared reverse.'
    : 'Choose the shared reverse for single-sided cards.'
  const issues = useMemo(() => cardIssues(cards, sharedBackId, allSides, missingBackMessage), [cards, sharedBackId, allSides, missingBackMessage])

  useEffect(() => {
    if (reverseLocked && !sharedBackId) setReverseLocked(false)
  }, [reverseLocked, sharedBackId])

  useEffect(() => {
    files.current.delete(DESIGN_SOURCE_ID)
    if (!backgroundFile) {
      setDesignBusy(false)
      setDesignError('')
      return
    }
    let cancelled = false
    setDesignBusy(true)
    setDesignError('')
    const timer = window.setTimeout(() => {
      void createReverseDesign(backgroundFile, logoFile, logoSettings)
        .then(result => {
          if (cancelled) return
          files.current.set(DESIGN_SOURCE_ID, { kind: 'image', bytes: result.bytes })
          setDesignResult({
            backgroundFile,
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
  }, [backgroundFile, logoFile, logoSettings])

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
    try {
      for (const file of Array.from(incoming)) {
        try {
          const result = await importSource(file)
          files.current.set(result.sides[0].sourceId, result.file)
          setSources(previous => [...previous, ...result.sides])
          importedSides += result.sides.length
        } catch (error) {
          errors.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      setMessage([
        importedSides ? `Imported ${importedSides} side${importedSides === 1 ? '' : 's'}.` : '',
        ...errors,
      ].filter(Boolean).join(' '))
    } finally {
      setBusy(false)
    }
  }

  function onInputChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) void addFiles(event.target.files)
    event.target.value = ''
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    if (!busy) void addFiles(event.dataTransfer.files)
  }

  function addCard(frontId: string) {
    if (used.has(frontId)) return
    setCards(previous => [...previous, {
      id: crypto.randomUUID(),
      frontId,
      backMode: 'shared',
      backId: null,
    }])
  }

  function deleteSourceSide(side: SourceSide) {
    if (busy) return
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
    setBackgroundFile(null)
    setReverseLocked(false)
    if (previewSide?.id === DESIGN_SIDE_ID) setPreviewSide(null)
  }

  function updateCard(id: string, update: Partial<Card>) {
    setCards(previous => previous.map(card => card.id === id ? { ...card, ...update } : card))
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
            <span>or drop files here. Each PDF page becomes one side.</span>
          </div>
          <p className="source-hint">Click a card image to read it at a larger size. Deleting an assigned front removes its card; deleting a reverse clears that selection.</p>
          {message && <p className="message" role="status">{message}</p>}
          {sources.length > 0 && (
            <div className="source-grid">
              {sources.map(side => (
                <article className="source-tile" key={side.id}>
                  <div className="source-image-wrap">
                    <button type="button" className="source-preview-button" onClick={() => openSourcePreview(side)} aria-label={`Enlarge ${side.label}`}>
                      <img src={side.thumbnailUrl} alt="" />
                    </button>
                    <button type="button" className="source-delete-button" onClick={() => deleteSourceSide(side)} disabled={busy} aria-label={`Delete ${side.label}`} title={`Delete ${side.label}`}>×</button>
                  </div>
                  {side.autoRotated && <span className="rotation-tag">Rotated 90° CCW</span>}
                  <div className="source-tile-footer">
                    <span title={side.label}>{side.label}</span>
                    <button type="button" onClick={() => addCard(side.id)} disabled={used.has(side.id) || busy}>
                      {used.has(side.id) ? 'Assigned' : 'Add front'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="panel" aria-labelledby="cards-heading">
          <div className="section-heading">
            <div><span className="step">2</span><h2 id="cards-heading">Set fronts and backs</h2></div>
            <span>{cards.length} cards</span>
          </div>
          <p className="hint">Add a front above. For a two-sided card, choose its back page below. All other cards use one shared reverse.</p>
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
            <label><input type="radio" name="reverse-choice" checked={reverseChoice === 'created'} onChange={() => setReverseChoice('created')} /> Create from images</label>
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
              <div className="design-files">
                <div className="design-file-field">
                  <span>Background image</span>
                  <input ref={backgroundInput} type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" onChange={event => {
                    if (event.target.files?.[0]) setBackgroundFile(event.target.files[0])
                    event.target.value = ''
                  }} hidden />
                  <button type="button" onClick={() => backgroundInput.current?.click()}>Choose background image</button>
                  <small title={backgroundFile?.name}>{backgroundFile?.name ?? 'No image selected'}</small>
                </div>
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
              </div>
              <p className="design-hint">The background fills the card. At 100% size, the logo occupies about one third of the card width. Position sliders keep it within the card.</p>
              {designBusy && <p role="status">Building reverse preview…</p>}
              {designError && <p className="preview-error" role="alert">{designError}</p>}
              {designedSide && <SharedReversePreview side={designedSide} onEnlarge={() => openSourcePreview(designedSide)} onRemoveBackground={removeBackground} removeDisabled={busy} />}
            </div>
          )}
          <button type="button" className="lock-reverse-button" onClick={() => setReverseLocked(true)} disabled={!sharedBackId || designBusy || busy}>Lock reverse</button>
          </>
          )}

          {cards.length === 0 ? <p className="empty-state">No cards yet. Use “Add front” on a source thumbnail.</p> : (
            <div className="card-list">
              {cards.map((card, index) => {
                const front = sourceById.get(card.frontId)
                const otherUsed = new Set<string>()
                for (const other of cards) {
                  if (other.id === card.id) continue
                  otherUsed.add(other.frontId)
                  if (other.backMode === 'custom' && other.backId) otherUsed.add(other.backId)
                }
                otherUsed.add(card.frontId)
                if (sharedBackId) otherUsed.add(sharedBackId)
                return (
                  <article className="card-row" key={card.id}>
                    <span className="card-number">{index + 1}</span>
                    {front && <img className="card-thumb" src={front.thumbnailUrl} alt="" />}
                    <div className="card-details">
                      <strong title={front?.label}>{front?.label ?? 'Missing front'}</strong>
                      <label>
                        <span>Reverse type</span>
                        <select value={card.backMode} onChange={event => updateCard(card.id, { backMode: event.target.value as Card['backMode'], backId: null })}>
                          <option value="shared">Shared reverse</option>
                          <option value="custom">Two-sided card</option>
                        </select>
                      </label>
                      {card.backMode === 'custom' && (
                        <label>
                          <span>Back page</span>
                          <select value={card.backId ?? ''} onChange={event => updateCard(card.id, { backId: event.target.value || null })}>
                            <option value="">Choose a page or image…</option>
                            {sources.filter(side => !otherUsed.has(side.id)).map(side => (
                              <option key={side.id} value={side.id}>{side.label}</option>
                            ))}
                          </select>
                        </label>
                      )}
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
