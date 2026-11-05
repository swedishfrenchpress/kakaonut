import { useEffect, useRef, useState, type ReactNode } from 'react'
import QRCode from 'qrcode'
import { useI18n } from '../i18n'
import { useDropImages, useFlash, usePasteImages } from '../hooks'
import { loadPhoto, photoToPixels, type LoadedPhoto } from '../photo'
import { makeStickerInWorker } from '../workerClient'
import {
  MINT_URL,
  checkClaimState,
  createInvoice,
  invoiceState,
  isTestMint,
  mintName,
  mintToken,
  type ClaimState,
} from '../mint'
import { claimLink } from '../config'
import { redeemUrl } from '../nav'
import { clearPendingPhoto, loadPendingPhoto, savePendingPhoto } from '../photoStore'
import {
  addToken,
  clearPending,
  deleteToken,
  loadPending,
  loadTokens,
  savePending,
  type PendingQuote,
  type SavedToken,
} from '../wallet'
import { canCopyImage, canShareFiles, copyPng, copyText, downloadBlob, shareFile } from '../actions'
import { DropOverlay } from './Composer'
import { Buddies, Loading } from './Buddies'
import { CheckIcon, ChevronIcon, CopyIcon, DownloadIcon, PhotoIcon, ShareIcon } from './Icons'

/**
 * Make: photo → amount → pay → photo with sats inside.
 * Money safety (spec 5.5): the quote is saved before the invoice is shown and resumed after a
 * reload; the token is saved before it's embedded; if saving fails the raw token is shown.
 */

type Made = { file: File; url: string; width: number; height: number }

type Stage =
  | { k: 'form' }
  | { k: 'quoting' }
  | { k: 'invoice'; pending: PendingQuote }
  | { k: 'minting'; amount: number }
  /** 'lost': paid, but the page reloaded and the photo couldn't be recovered. 'put': a saved token. */
  | {
      k: 'needPhoto'
      saved: SavedToken
      unsaved: boolean
      edge: number
      why: 'lost' | 'put'
    }
  | { k: 'embedding'; saved: SavedToken }
  | { k: 'done'; saved: SavedToken; made: Made; unsaved: boolean }
  | { k: 'issued' }
  | { k: 'error'; message: string; retry?: () => void }

const EDGES = [2048, 1280, 640]
const PRESETS = [1000, 5000, 10000, 20000]
const MAX_AMOUNT = 10_000_000

function parseAmount(text: string): number | null {
  const clean = text.replace(/[\s,._]/g, '')
  if (!/^\d+$/.test(clean)) return null
  const n = Number(clean)
  return n >= 1 && n <= MAX_AMOUNT ? n : null
}

/** `head` is the section heading; it sits in the grid beside the photo on wide screens. */
export function MakeFlow({ active, head }: { active: boolean; head: ReactNode }) {
  const { t, num } = useI18n()
  const [photo, setPhoto] = useState<LoadedPhoto | null>(null)
  const [photoError, setPhotoError] = useState(false)
  const [amountText, setAmountText] = useState('1,000')
  const [edge, setEdge] = useState(2048)
  const [stage, setStage] = useState<Stage>(() => {
    const pending = loadPending()
    return pending ? { k: 'invoice', pending } : { k: 'form' }
  })
  const [offline, setOffline] = useState(false)
  const [saved, setSaved] = useState<SavedToken[]>(loadTokens)
  const photoRef = useRef(photo)
  photoRef.current = photo
  /** The file behind `photo`, kept so it can be stored while its invoice is paid. */
  const photoFile = useRef<Blob | null>(null)
  const madeUrls = useRef<string[]>([])
  const card = useRef<HTMLDivElement>(null)

  useEffect(
    () => () => {
      photoRef.current?.release()
      madeUrls.current.forEach((u) => URL.revokeObjectURL(u))
    },
    [],
  )

  const amount = parseAmount(amountText)
  const mintUrl = MINT_URL

  const choosePhoto = async (files: File[]) => {
    const file = files[0]
    if (!file) return
    try {
      const next = await loadPhoto(file)
      photoRef.current?.release()
      setPhoto(next)
      photoFile.current = file
      setPhotoError(false)
      if (stage.k === 'needPhoto') void embed(stage.saved, next, stage.edge, stage.unsaved)
    } catch {
      setPhotoError(true)
    }
  }

  const embed = async (tok: SavedToken, from: LoadedPhoto, size: number, unsaved: boolean) => {
    setStage({ k: 'embedding', saved: tok })
    try {
      const pixels = photoToPixels(from, size)
      const made = await makeStickerInWorker(pixels, tok.token)
      const file = new File([made.png as BlobPart], `kakaonut-${tok.amount}-sats.png`, { type: 'image/png' })
      const url = URL.createObjectURL(file)
      madeUrls.current.push(url)
      setStage({
        k: 'done',
        saved: tok,
        made: { file, url, width: made.width, height: made.height },
        unsaved,
      })
      card.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    } catch (e) {
      setStage({
        k: 'error',
        message: t('make.error', { error: errorText(e) }),
        retry: () =>
          setStage({
            k: 'needPhoto',
            saved: tok,
            unsaved,
            edge: size,
            why: 'put',
          }),
      })
    }
  }

  const finish = async (pending: PendingQuote) => {
    setStage({ k: 'minting', amount: pending.amount })
    let token: string
    try {
      token = await mintToken(pending.mint, pending.amount, pending.quote)
    } catch (e) {
      // The quote stays saved, so a retry (or a reload) picks it up again.
      setStage({
        k: 'error',
        message: t('make.error', { error: errorText(e) }),
        retry: () => setStage({ k: 'invoice', pending }),
      })
      return
    }
    const tok: SavedToken = {
      id: pending.quote,
      token,
      mint: pending.mint,
      amount: pending.amount,
      createdAt: Date.now(),
    }
    const stored = addToken(tok) // saved before anything else happens to it
    clearPending()
    setSaved(stored ? loadTokens() : (list) => [tok, ...list])
    // The page may have reloaded while the invoice was paid (common on phones): get the photo back.
    let current = photoRef.current
    if (!current) {
      const kept = await loadPendingPhoto(pending.quote)
      if (kept) {
        try {
          current = await loadPhoto(kept)
          photoFile.current = kept
          setPhoto(current)
        } catch {
          current = null
        }
      }
    }
    void clearPendingPhoto()
    if (!current)
      setStage({
        k: 'needPhoto',
        saved: tok,
        unsaved: !stored,
        edge: pending.edge,
        why: 'lost',
      })
    else await embed(tok, current, pending.edge, !stored)
  }

  // Poll the invoice every 2 s while it's on screen (also after a reload).
  useEffect(() => {
    if (stage.k !== 'invoice') return
    const { pending } = stage
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      try {
        const state = await invoiceState(pending.mint, pending.quote)
        if (stopped) return
        setOffline(false)
        if (state === 'PAID') {
          stopped = true
          void finish(pending)
          return
        }
        if (state === 'ISSUED') {
          stopped = true
          clearPending()
          void clearPendingPhoto()
          setSaved(loadTokens())
          setStage({ k: 'issued' })
          return
        }
      } catch {
        if (!stopped) setOffline(true)
      }
      if (!stopped) timer = setTimeout(tick, 2000)
    }
    timer = setTimeout(tick, 1000)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [stage])

  const pay = async () => {
    if (!photo || !amount) return
    setStage({ k: 'quoting' })
    try {
      const inv = await createInvoice(mintUrl, amount)
      const pending: PendingQuote = {
        mint: mintUrl,
        amount,
        quote: inv.quote,
        request: inv.request,
        createdAt: Date.now(),
        edge,
      }
      savePending(pending) // before the invoice is shown
      if (photoFile.current) await savePendingPhoto(pending.quote, photoFile.current)
      setStage({ k: 'invoice', pending })
    } catch (e) {
      setStage({
        k: 'error',
        message: t('make.error', { error: errorText(e) }),
        retry: () => setStage({ k: 'form' }),
      })
    }
  }

  const cancel = async (pending: PendingQuote) => {
    // Paid at the last second? Then finish instead of throwing the payment away.
    try {
      if ((await invoiceState(pending.mint, pending.quote)) === 'PAID') return void finish(pending)
    } catch {
      // can't tell: keep it simple and cancel
    }
    clearPending()
    void clearPendingPhoto()
    setStage({ k: 'form' })
  }

  const reset = () => {
    photoRef.current?.release()
    setPhoto(null)
    setStage({ k: 'form' })
  }

  usePasteImages((files) => void choosePhoto(files), active && (stage.k === 'form' || stage.k === 'needPhoto'))
  const dragging = useDropImages(
    (files) => void choosePhoto(files),
    active && (stage.k === 'form' || stage.k === 'needPhoto'),
  )

  // Two slots: the photo (left on wide screens) and the money side (right). Phones stack them.
  let photoSlot: ReactNode = null
  let photoAside = false // only useful beside the panel: skipped on phones so the invoice stays high
  let panel: ReactNode = null

  switch (stage.k) {
    case 'form':
    case 'quoting':
      photoSlot = <PhotoPicker photo={photo} onFiles={choosePhoto} error={photoError} testId="make-photo-input" />
      panel = (
        <>
          <div className="amount-field">
            <label className="tile-label" htmlFor="make-amount">
              {t('make.step.amount')}
            </label>
            <div className="amount">
              {/* The hidden copy of the text gives the field its exact width, so "sats" sits right after it. */}
              <span className="amount-input">
                <span className="amount-sizer" aria-hidden="true">
                  {amountText || '0'}
                </span>
                <input
                  id="make-amount"
                  inputMode="numeric"
                  autoComplete="off"
                  value={amountText}
                  onChange={(e) => {
                    // Keep the big number readable while typing: 20000 → 20,000.
                    const digits = e.target.value
                      .replace(/\D/g, '')
                      .replace(/^0+(?=\d)/, '')
                      .slice(0, 9)
                    setAmountText(digits ? num(Number(digits)) : '')
                  }}
                  aria-invalid={amount === null}
                  aria-describedby={amount === null ? 'make-amount-error' : undefined}
                  data-testid="amount-input"
                />
              </span>
              <span className="amount-unit">sats</span>
            </div>
            {amount === null && (
              <p className="field-error" id="make-amount-error">
                {t('make.amount.invalid')}
              </p>
            )}
            <div className="presets">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="preset"
                  aria-pressed={amount === p}
                  onClick={() => setAmountText(num(p))}
                >
                  {num(p)}
                </button>
              ))}
            </div>
          </div>

          <div className="pay-group">
            <div className="group">
              <label className="group-row">
                <span className="group-label">{t('make.size.label')}</span>
                <span className="select">
                  <select value={edge} onChange={(e) => setEdge(Number(e.target.value))}>
                    {EDGES.map((e) => (
                      <option key={e} value={e}>
                        {e === 2048 ? t('make.size.original') : t('sticker.px', { size: e })}
                      </option>
                    ))}
                  </select>
                  <ChevronIcon size={16} />
                </span>
              </label>
            </div>
            <button
              type="button"
              className={`btn btn--primary btn--xl btn--block${stage.k === 'quoting' ? ' is-busy' : ''}`}
              disabled={!photo || !amount || stage.k === 'quoting'}
              aria-busy={stage.k === 'quoting'}
              onClick={pay}
            >
              {stage.k === 'quoting' && <Buddies size={22} />}
              {stage.k === 'quoting'
                ? t('invoice.creating')
                : !photo
                  ? t('make.pay.needPhoto')
                  : t('make.pay', { amount: amount ? num(amount) : '–' })}
            </button>
          </div>
        </>
      )
      break
    case 'invoice':
      photoSlot = photo && <PhotoPreview url={photo.url} amount={stage.pending.amount} />
      photoAside = true
      panel = <InvoiceView pending={stage.pending} offline={offline} onCancel={() => void cancel(stage.pending)} />
      break
    case 'minting':
    case 'embedding':
      photoSlot = photo && (
        <PhotoPreview url={photo.url} amount={stage.k === 'minting' ? stage.amount : stage.saved.amount} />
      )
      photoAside = true
      panel = (
        <div className="tile working">
          <Loading label={t('make.minting')} size={44} layout="column" />
        </div>
      )
      break
    case 'needPhoto':
      photoSlot = <PhotoPicker photo={null} onFiles={choosePhoto} error={photoError} testId="make-photo-input" />
      panel = (
        <div className="tile notice">
          <p className="notice-title">
            {stage.why === 'lost' ? t('make.needPhoto') : t('make.putPhoto', { amount: num(stage.saved.amount) })}
          </p>
          {stage.unsaved && <RawToken token={stage.saved.token} />}
        </div>
      )
      break
    case 'done':
      photoSlot = <DonePhoto stage={stage} />
      panel = <Done stage={stage} onAgain={reset} />
      break
    case 'issued':
      panel = (
        <div className="tile notice">
          <p className="notice-title">{t('invoice.issued')}</p>
          <button type="button" className="btn btn--primary btn--block" onClick={reset}>
            {t('make.done.again')}
          </button>
        </div>
      )
      break
    case 'error':
      photoSlot = photo && <PhotoPreview url={photo.url} />
      photoAside = true
      panel = (
        <div className="tile notice" role="alert">
          <p className="notice-title notice-title--bad">{stage.message}</p>
          <div className="btn-row">
            {stage.retry && (
              <button type="button" className="btn btn--primary" onClick={stage.retry}>
                {t('make.retry')}
              </button>
            )}
            <button type="button" className="btn btn--quiet" onClick={reset}>
              {t('invoice.cancel')}
            </button>
          </div>
        </div>
      )
      break
  }

  return (
    <>
      {active && <DropOverlay show={dragging} label={t('drop.overlay')} />}
      <div className={`make-grid${photoSlot ? '' : ' make-grid--solo'}`} ref={card}>
        {head}
        {photoSlot && <div className={`make-photo${photoAside ? ' make-photo--aside' : ''}`}>{photoSlot}</div>}
        <div className="make-panel">{panel}</div>
        <SavedList
          tokens={saved}
          onPut={(tok) => {
            setStage({
              k: 'needPhoto',
              saved: tok,
              unsaved: false,
              edge,
              why: 'put',
            })
            card.current?.scrollIntoView({
              block: 'start',
              behavior: 'smooth',
            })
          }}
          onDelete={(id) => {
            deleteToken(id)
            setSaved(loadTokens())
          }}
        />
      </div>
    </>
  )
}

/** The photo being paid for, with the amount it will hold. */
function PhotoPreview({ url, amount }: { url: string; amount?: number }) {
  const { t, num } = useI18n()
  return (
    <div className="make-preview">
      <img src={url} alt="" />
      {amount !== undefined && <span className="done-badge">{t('make.inside', { amount: num(amount) })}</span>}
    </div>
  )
}

function DonePhoto({ stage }: { stage: Extract<Stage, { k: 'done' }> }) {
  const { t, num } = useI18n()
  return (
    <div className="done-photo">
      <img src={stage.made.url} alt="" />
      <span className="done-badge">{t('make.inside', { amount: num(stage.saved.amount) })}</span>
    </div>
  )
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function PhotoPicker({
  photo,
  onFiles,
  error,
  testId,
}: {
  photo: LoadedPhoto | null
  onFiles: (files: File[]) => void
  error: boolean
  testId: string
}) {
  const { t } = useI18n()
  const input = useRef<HTMLInputElement>(null)
  return (
    <div>
      <button type="button" className={`picker${photo ? ' picker--has' : ''}`} onClick={() => input.current?.click()}>
        {photo ? (
          <>
            <img src={photo.url} alt="" />
            <span className="picker-change">{t('make.photo.change')}</span>
          </>
        ) : (
          <>
            <PhotoIcon size={30} className="picker-icon" />
            <span className="picker-title">{t('make.step.photo')}</span>
            <span className="picker-hint">{t('make.photo.dropHint')}</span>
          </>
        )}
      </button>
      {error && <p className="field-error">{t('pick.unreadable')}</p>}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        data-testid={testId}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length) onFiles(files)
        }}
      />
    </div>
  )
}

function InvoiceView({
  pending,
  offline,
  onCancel,
}: {
  pending: PendingQuote
  offline: boolean
  onCancel: () => void
}) {
  const { t, num } = useI18n()
  const [qr, setQr] = useState<string | null>(null)
  const [copied, flash] = useFlash()
  useEffect(() => {
    let live = true
    QRCode.toDataURL(pending.request.toUpperCase(), {
      margin: 0,
      width: 560,
      errorCorrectionLevel: 'M',
    })
      .then((url) => live && setQr(url))
      .catch(() => live && setQr(null))
    return () => {
      live = false
    }
  }, [pending.request])
  return (
    <div className="tile invoice" data-testid="invoice">
      <p className="invoice-title">{t('invoice.title')}</p>
      <p className="invoice-amount">
        {num(pending.amount)} <span>sats</span>
      </p>
      {isTestMint(pending.mint) && <p className="invoice-note">{t('token.testMint')}</p>}
      <a className="qr" href={`lightning:${pending.request}`} aria-label={t('invoice.open')}>
        {qr ? <img src={qr} alt="" /> : <Buddies size={30} />}
      </a>
      <Loading className="waiting" label={offline ? t('invoice.offline') : t('invoice.waiting')} size={20} />
      <div className="stack">
        <div className="invoice-buttons">
          <a className="btn btn--primary" href={`lightning:${pending.request}`}>
            {t('invoice.open')}
          </a>
          <button
            type="button"
            className="btn btn--quiet"
            onClick={async () => flash((await copyText(pending.request)) ? t('action.copied') : t('action.copyFailed'))}
          >
            <CopyIcon size={18} />
            {copied ?? t('invoice.copy')}
          </button>
        </div>
        <button type="button" className="btn btn--text" onClick={onCancel}>
          {t('invoice.cancel')}
        </button>
      </div>
    </div>
  )
}

function Done({ stage, onAgain }: { stage: Extract<Stage, { k: 'done' }>; onAgain: () => void }) {
  const { t, num, bytes } = useI18n()
  const [flash, setFlash] = useFlash()
  const { made, saved, unsaved } = stage
  const share = canShareFiles(made.file)
  return (
    <div className="done" data-testid="made-photo">
      <div className="done-card">
        <p className="done-title">{t('make.done.title', { amount: num(saved.amount) })}</p>
        <p className="done-facts">
          <span>PNG</span> ·{' '}
          <span>
            {made.width}×{made.height}
          </span>{' '}
          · <span>{bytes(made.file.size)}</span> ·{' '}
          <span className="ok">
            <CheckIcon size={14} /> {t('sticker.checked')}
          </span>
        </p>
        <div className="stack">
          <button
            type="button"
            className="btn btn--primary btn--xl btn--block"
            onClick={() => downloadBlob(made.file, made.file.name)}
          >
            <DownloadIcon size={20} />
            {t('action.download')}
          </button>
          {(share || canCopyImage()) && (
            <div className="btn-row">
              {share && (
                <button
                  type="button"
                  className="btn btn--quiet"
                  onClick={() => void shareFile(made.file, t('share.text', { url: redeemUrl() }))}
                >
                  <ShareIcon size={18} />
                  {t('action.share')}
                </button>
              )}
              {canCopyImage() && (
                <button
                  type="button"
                  className="btn btn--quiet"
                  onClick={async () =>
                    setFlash((await copyPng(made.file)) ? t('action.copied') : t('action.copyFailed'))
                  }
                >
                  <CopyIcon size={18} />
                  {flash ?? t('action.copyImage')}
                </button>
              )}
            </div>
          )}
        </div>
        <p className="done-tip">{t('make.done.tip')}</p>
        {unsaved && <RawToken token={saved.token} />}
      </div>
      <button type="button" className="btn btn--text done-again" onClick={onAgain}>
        {t('make.done.again')}
      </button>
    </div>
  )
}

function RawToken({ token }: { token: string }) {
  const { t } = useI18n()
  const [copied, flash] = useFlash()
  return (
    <div className="raw-token" role="alert">
      <p>{t('make.storageFailed')}</p>
      <textarea readOnly value={token} rows={3} onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className="btn btn--primary btn--block"
        onClick={async () => flash((await copyText(token)) ? t('action.copied') : t('action.copyFailed'))}
      >
        {copied ?? t('token.copy')}
      </button>
    </div>
  )
}

function SavedList({
  tokens,
  onPut,
  onDelete,
}: {
  tokens: SavedToken[]
  onPut: (t: SavedToken) => void
  onDelete: (id: string) => void
}) {
  const { t } = useI18n()
  if (!tokens.length) return null
  return (
    <details className="saved">
      <summary className="saved-summary">
        <span className="saved-title">{t('saved.title')}</span>
        <span className="saved-count">{tokens.length}</span>
        <ChevronIcon size={18} className="saved-chevron" />
      </summary>
      <ul className="group">
        {tokens.map((tok) => (
          <SavedItem key={tok.id} tok={tok} onPut={() => onPut(tok)} onDelete={() => onDelete(tok.id)} />
        ))}
      </ul>
      <p className="group-caption">{t('saved.hint')}</p>
    </details>
  )
}

function SavedItem({ tok, onPut, onDelete }: { tok: SavedToken; onPut: () => void; onDelete: () => void }) {
  const { t, num, lang } = useI18n()
  const [claim, setClaim] = useState<ClaimState | 'checking' | 'unknown'>('checking')
  const [armed, setArmed] = useState(false)
  const [copied, flash] = useFlash()
  useEffect(() => {
    let live = true
    checkClaimState(tok.token)
      .then((s) => live && setClaim(s))
      .catch(() => live && setClaim('unknown'))
    return () => {
      live = false
    }
  }, [tok.token])
  const when = new Intl.DateTimeFormat(lang, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(tok.createdAt)
  return (
    <li className="saved-item">
      <div className="saved-row">
        <strong>
          {num(tok.amount)} <span>sats</span>
        </strong>
        <span className={`status status--${claim}`}>
          {claim === 'checking' ? t('state.checking') : t(`state.${claim}`)}
        </span>
      </div>
      <p className="saved-meta">
        {when} · {mintName(tok.mint)}
        {isTestMint(tok.mint) && ` · ${t('make.mint.test')}`}
      </p>
      <div className="saved-actions">
        <button type="button" className="link" onClick={onPut}>
          {t('saved.put')}
        </button>
        <a className="link" href={claimLink(tok.token)} target="_blank" rel="noopener noreferrer">
          {t('saved.takeBack')}
        </a>
        <button
          type="button"
          className="link"
          onClick={async () => flash((await copyText(tok.token)) ? t('action.copied') : t('action.copyFailed'))}
        >
          {copied ?? t('token.copy')}
        </button>
        <button
          type="button"
          className={`link link--danger${armed ? ' is-armed' : ''}`}
          onClick={() => (armed ? onDelete() : setArmed(true))}
          onBlur={() => setArmed(false)}
        >
          {armed ? t('saved.deleteConfirm') : t('saved.delete')}
        </button>
      </div>
    </li>
  )
}
