import { useEffect, useRef, useState } from 'react'
import { useI18n, type Key } from '../i18n'
import { useDropImages, usePasteImages } from '../hooks'
import { readStickerInWorker } from '../workerClient'
import type { StickerReadResult } from '../read'
import { isTestPayload } from '../testPayload'
import { checkClaimState, summarizeToken, type TokenSummary } from '../mint'
import { loadBtcPrice } from '../price'
import { canReadClipboardImages, readClipboardImage } from '../actions'
import { ClaimCard, type TokenCheck } from './ClaimCard'
import { DropOverlay } from './Composer'
import { Loading } from './Buddies'
import { CopyIcon, PhotoIcon } from './Icons'

/**
 * Redeem: paste or choose the photo a friend sent, see what's inside, take the bitcoin.
 * One photo at a time; a new paste or drop replaces the current one.
 */

interface Picked {
  name: string
  url: string
}

type Outcome =
  | { k: 'money'; token: string; check: TokenCheck }
  | { k: 'test'; status: 'intact' | 'repaired' }
  | { k: 'none' | 'erased' | 'damaged' | 'unreadable' }

type Stage = { k: 'idle' } | { k: 'reading'; photo: Picked } | { k: 'done'; photo: Picked; outcome: Outcome }

const MIN_READING_MS = 700 // long enough to see the buddies, short enough not to wait on them
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function outcomeOf(result: StickerReadResult): Outcome {
  if (!result.ok) return { k: result.reason }
  if (isTestPayload(result.token)) return { k: 'test', status: result.status }
  return { k: 'money', token: result.token, check: { claim: 'checking' } }
}

export function RedeemFlow({ active }: { active: boolean }) {
  const { t } = useI18n()
  const [stage, setStage] = useState<Stage>({ k: 'idle' })
  const [notice, setNotice] = useState<string | null>(null)
  const run = useRef(0)
  const url = useRef<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const canPaste = canReadClipboardImages()

  useEffect(
    () => () => {
      if (url.current) URL.revokeObjectURL(url.current)
    },
    [],
  )

  const read = async (files: File[]) => {
    const file = files[0]
    if (!file) return
    setNotice(null)
    const id = ++run.current
    if (url.current) URL.revokeObjectURL(url.current)
    url.current = URL.createObjectURL(file)
    const photo = { name: file.name || t('open.pastedName'), url: url.current }
    setStage({ k: 'reading', photo })

    let result: StickerReadResult | null
    try {
      ;[result] = await Promise.all([readStickerInWorker(file), sleep(MIN_READING_MS)])
    } catch {
      result = null
    }
    if (id !== run.current) return
    if (!result) return setStage({ k: 'done', photo, outcome: { k: 'unreadable' } })

    const outcome = outcomeOf(result)
    if (outcome.k !== 'money') return setStage({ k: 'done', photo, outcome })

    // Real bitcoin: get the amount (and the price for dollars or won) before showing the card.
    void loadBtcPrice().catch(() => {})
    let summary: TokenSummary
    try {
      summary = await summarizeToken(outcome.token)
    } catch {
      if (id === run.current) setStage({ k: 'done', photo, outcome: { ...outcome, check: { claim: 'unknown', invalid: true } } })
      return
    }
    if (id !== run.current) return
    setStage({ k: 'done', photo, outcome: { ...outcome, check: { summary, claim: 'checking' } } })
    let claim: TokenCheck['claim']
    try {
      claim = await checkClaimState(outcome.token)
    } catch {
      claim = 'unknown'
    }
    if (id !== run.current) return
    setStage({ k: 'done', photo, outcome: { ...outcome, check: { summary, claim } } })
  }

  const paste = async () => {
    const got = await readClipboardImage('pasted')
    if (got === 'empty') setNotice(t('redeem.pasteEmpty'))
    else if (got === 'denied') setNotice(t('redeem.pasteDenied'))
    else void read([got])
  }

  const reset = () => {
    run.current++
    setNotice(null)
    setStage({ k: 'idle' })
  }

  usePasteImages((files) => void read(files), active)
  const dragging = useDropImages((files) => void read(files), active)

  return (
    <div className="make-body redeem">
      {active && <DropOverlay show={dragging} label={t('drop.overlay')} />}

      {stage.k === 'idle' ? (
        <div className="tile redeem-pick">
          <PhotoIcon size={30} className="redeem-icon" />
          <p className="redeem-prompt">{t('redeem.prompt')}</p>
          {canPaste && (
            <button type="button" className="btn btn--primary btn--lg btn--block" onClick={paste}>
              <CopyIcon size={20} />
              {t('redeem.paste')}
            </button>
          )}
          <button
            type="button"
            className={canPaste ? 'btn btn--text' : 'btn btn--primary btn--lg btn--block'}
            onClick={() => input.current?.click()}
          >
            {!canPaste && <PhotoIcon size={20} />}
            {t('redeem.choose')}
          </button>
          {notice && (
            <p className="redeem-notice" role="status">
              {notice}
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="redeem-photo">
            <img src={stage.photo.url} alt="" />
            <span>{stage.photo.name}</span>
          </div>
          {stage.k === 'reading' ? (
            <div className="tile redeem-loading">
              <Loading label={t('redeem.reading')} size={40} layout="column" />
            </div>
          ) : (
            <Outcome outcome={stage.outcome} />
          )}
          <button type="button" className="btn btn--text redeem-again" onClick={reset}>
            {t('redeem.again')}
          </button>
        </>
      )}

      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        data-testid="redeem-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = '' // allow choosing the same file again
          if (files.length) void read(files)
        }}
      />
    </div>
  )
}

function Outcome({ outcome }: { outcome: Outcome }) {
  const { t } = useI18n()
  if (outcome.k === 'money') {
    if (outcome.check.invalid) return <Message kind="unreadable" />
    return (
      <div data-redeem="money">
        <ClaimCard token={outcome.token} check={outcome.check} />
      </div>
    )
  }
  if (outcome.k === 'test') {
    return (
      <div className="tile redeem-msg" data-redeem="test">
        <h3>{t('redeem.test.title')}</h3>
        <p>{t(`redeem.test.${outcome.status}`)}</p>
      </div>
    )
  }
  return <Message kind={outcome.k} />
}

function Message({ kind }: { kind: 'none' | 'erased' | 'damaged' | 'unreadable' }) {
  const { t } = useI18n()
  return (
    <div className="tile redeem-msg" data-redeem={kind} role="status">
      <h3>{t(`redeem.${kind}.title` as Key)}</h3>
      <p>{t(`redeem.${kind}.body` as Key)}</p>
    </div>
  )
}
