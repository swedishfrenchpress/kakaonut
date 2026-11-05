import { Fragment, useEffect, useRef, useState } from 'react'
import { Bot, Me, SysChip, Thread, Typing } from '../components/Chat'
import { Composer, DropOverlay } from '../components/Composer'
import { useI18n, type Key } from '../i18n'
import { useDropImages, useFlash, usePasteImages } from '../hooks'
import { readStickerInWorker } from '../workerClient'
import type { StickerReadResult } from '../read'
import { FORMAT_NAMES } from '../imageInfo'
import { isTestPayload, parseTestPayload, type TestPayloadInfo } from '../testPayload'
import { checkClaimState, mintHost, summarizeToken, type ClaimState, type TokenSummary } from '../mint'
import { canReadClipboardImages, copyText, readClipboardImage } from '../actions'
import { CopyIcon, PhotoIcon } from '../components/Icons'

/**
 * Open: reads any image and says what's in it. Also the Phase 0 instrument, so it keeps a thread
 * of every image opened and can copy them all as a results table.
 */

interface TokenCheck {
  summary?: TokenSummary
  invalid?: boolean
  claim: 'checking' | ClaimState | 'unknown'
}

interface Entry {
  id: number
  name: string
  url: string
  reading: boolean
  error?: string
  result?: StickerReadResult
  test?: TestPayloadInfo | null
  token?: TokenCheck
}

export function OpenScreen({ active }: { active: boolean }) {
  const { t, bytes } = useI18n()
  const [entries, setEntries] = useState<Entry[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, flashCopied] = useFlash()
  const nextId = useRef(0)
  // Bumped by Clear. Work started before a Clear never writes into the new thread.
  const generation = useRef(0)
  const urls = useRef<string[]>([])

  useEffect(
    () => () => {
      urls.current.forEach((u) => URL.revokeObjectURL(u))
    },
    [],
  )

  const update = (gen: number, id: number, patch: (e: Entry) => Partial<Entry>) => {
    if (gen !== generation.current) return
    setEntries((es) => es.map((e) => (e.id === id ? { ...e, ...patch(e) } : e)))
  }

  const checkToken = async (gen: number, id: number, token: string) => {
    let summary: TokenSummary
    try {
      summary = await summarizeToken(token)
    } catch {
      return update(gen, id, () => ({ token: { claim: 'unknown', invalid: true } }))
    }
    update(gen, id, () => ({ token: { summary, claim: 'checking' } }))
    let claim: TokenCheck['claim']
    try {
      claim = await checkClaimState(token)
    } catch {
      claim = 'unknown'
    }
    update(gen, id, (e) => ({ token: { ...e.token, summary, claim } }))
  }

  const open = async (files: File[]) => {
    setNotice(null)
    const gen = generation.current
    const fresh: Entry[] = files.map((f) => {
      const url = URL.createObjectURL(f)
      urls.current.push(url)
      return { id: ++nextId.current, name: f.name || t('open.pastedName'), url, reading: true }
    })
    setEntries((es) => [...es, ...fresh])

    // One at a time: decoding a 2048 px PNG is heavy on a phone.
    for (const [i, file] of files.entries()) {
      const id = fresh[i].id
      let result: StickerReadResult
      try {
        result = await readStickerInWorker(file)
      } catch (e) {
        update(gen, id, () => ({ reading: false, error: e instanceof Error ? e.message : String(e) }))
        continue
      }
      const realToken = result.ok && !isTestPayload(result.token)
      update(gen, id, () => ({
        reading: false,
        result,
        test: result.ok ? parseTestPayload(result.token) : null,
        token: realToken ? { claim: 'checking' } : undefined,
      }))
      if (result.ok && realToken) void checkToken(gen, id, result.token)
    }
  }

  const clear = () => {
    generation.current++
    urls.current.forEach((u) => URL.revokeObjectURL(u))
    urls.current = []
    setEntries([])
    setNotice(null)
  }

  const pasteFromButton = async () => {
    const got = await readClipboardImage('pasted')
    if (got === 'empty') setNotice(t('pick.pasteEmpty'))
    else if (got === 'denied') setNotice(t('pick.pasteDenied'))
    else void open([got])
  }

  const copyResults = async () => {
    const head = [t('results.file'), t('results.format'), t('results.pixels'), t('results.bytes'), t('results.result'), t('results.madeAt')]
    const rows = entries
      .filter((e) => !e.reading)
      .map((e) => {
        const r = e.result
        return [
          e.name.replace(/\|/g, '/'),
          r ? formatName(r.format, t) : '',
          r?.width ? `${r.width}×${r.height}` : '',
          r ? bytes(r.size) : '',
          shortVerdict(e, t),
          e.test ? `${e.test.width}×${e.test.height}` : '',
        ]
      })
    const md = [head, head.map(() => '---'), ...rows].map((r) => `| ${r.join(' | ')} |`).join('\n')
    flashCopied((await copyText(md)) ? t('action.copied') : t('action.copyFailed'))
  }

  usePasteImages((files) => void open(files), active)
  const dragging = useDropImages((files) => void open(files), active)

  return (
    <>
      <Thread>
        <SysChip>{t('open.notice')}</SysChip>
        <Bot head>
          {t('open.hello')}
        </Bot>
        <Bot delay={450}>{t('open.explain')} 👇</Bot>

        {entries.map((e) => (
          <Fragment key={e.id}>
            <Me media>
              <Thumb entry={e} />
              <span className="media-caption">{e.name}</span>
            </Me>
            <Bot head busy={e.reading} typing={0} scrollIntoView>
              <Verdict entry={e} />
            </Bot>
          </Fragment>
        ))}

        {notice && <SysChip>{notice}</SysChip>}

        {entries.length > 0 && (
          <div className="thread-tools">
            <button type="button" className="btn btn--soft btn--sm" onClick={copyResults}>
              {copied ?? t('open.copyResults')}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={clear}>
              {t('open.clear')}
            </button>
          </div>
        )}
      </Thread>

      {active && <DropOverlay show={dragging} label={t('drop.overlay')} />}
      <Composer
        label={t('pick.chooseImage')}
        icon={<PhotoIcon size={20} />}
        multiple
        hint={t('pick.orDrop')}
        onFiles={(files) => void open(files)}
        testId="open-input"
      >
        {canReadClipboardImages() && (
          <button type="button" className="btn btn--soft" onClick={pasteFromButton}>
            <CopyIcon size={20} />
            {t('pick.paste')}
          </button>
        )}
      </Composer>
    </>
  )
}

type T = ReturnType<typeof useI18n>['t']

function formatName(format: StickerReadResult['format'], t: T): string {
  return format === 'unknown' ? t('format.unknown') : FORMAT_NAMES[format]
}

function verdictKey(e: Entry): 'intact' | 'repaired' | 'damaged' | 'none' | 'erased' | 'unreadable' {
  const r = e.result
  if (!r || e.error) return 'unreadable'
  return r.ok ? r.status : r.reason
}

function shortVerdict(e: Entry, t: T): string {
  return t(`verdict.short.${verdictKey(e)}` as Key)
}

function Thumb({ entry }: { entry: Entry }) {
  const [broken, setBroken] = useState(false)
  if (broken) {
    return (
      <span className="media-file" aria-hidden="true">
        🗂️
      </span>
    )
  }
  return <img className="media-img" src={entry.url} alt="" onError={() => setBroken(true)} />
}

function warningText(w: string, t: T): string {
  if (/palette/i.test(w)) return t('warn.palette')
  if (/16-bit/i.test(w)) return t('warn.depth16')
  if (/greyscale|grayscale/i.test(w)) return t('warn.grey')
  return t('warn.other', { detail: w })
}

function Facts({ r, bad }: { r: StickerReadResult; bad?: boolean }) {
  const { t, bytes } = useI18n()
  return (
    <div className="chips" data-testid="facts">
      <span className={`chip${bad ? ' chip--bad' : ''}`}>{formatName(r.format, t)}</span>
      <span className="chip">{r.width ? `${r.width}×${r.height}` : t('facts.dimsUnknown')}</span>
      <span className="chip">{bytes(r.size)}</span>
    </div>
  )
}

function Verdict({ entry: e }: { entry: Entry }) {
  const { t } = useI18n()
  const key = verdictKey(e)
  const r = e.result

  if (!r || e.error) {
    return (
      <div data-verdict="unreadable">
        <p className="lead">{t('verdict.unreadable.title')}</p>
        <p>{t('verdict.unreadable.body')}</p>
      </div>
    )
  }

  const warnings = r.warnings.length > 0 && (
    <ul className="warnings">
      {r.warnings.map((w) => (
        <li key={w}>{warningText(w, t)}</li>
      ))}
    </ul>
  )

  if (r.ok && e.token) {
    return (
      <div data-verdict={key}>
        <TokenFound token={r.token} check={e.token} status={r.status} />
        <Facts r={r} />
        {warnings}
      </div>
    )
  }

  return (
    <div data-verdict={key}>
      <p className="lead">{t(`verdict.${key}.title` as Key)}</p>
      {key === 'erased' ? (
        <>
          <p>{t('verdict.erased.body', { format: formatName(r.format, t) })}</p>
          <p className="muted">{t('verdict.erased.hint')}</p>
        </>
      ) : (
        <p>{t(`verdict.${key}.body` as Key)}</p>
      )}
      {e.test && <p className="test-line">{t('test.found', { w: e.test.width, h: e.test.height })}</p>}
      <Facts r={r} bad={key === 'erased' || key === 'damaged'} />
      {warnings}
    </div>
  )
}

function TokenFound({ token, check, status }: { token: string; check: TokenCheck; status: 'intact' | 'repaired' }) {
  const { t, num } = useI18n()
  const [copied, flash] = useFlash()
  if (check.invalid) return <p className="lead">{t('token.invalid')}</p>
  if (!check.summary) return <Typing />
  const { amount, mint } = check.summary
  const isTestMint = /testnut/i.test(mint)
  return (
    <div className="token">
      <p className="token-amount">
        <span className="token-num">{num(amount)}</span> <span className="token-unit">sats</span>
      </p>
      <p className="muted small">
        {t(`verdict.${status}.title`)} · {t('token.mint', { mint: mintHost(mint) })}
      </p>
      {isTestMint && <p className="tag tag--test">{t('token.testMint')}</p>}
      <p className={`claim claim--${check.claim}`} data-testid="claim-state">
        {check.claim === 'checking' ? t('state.checking') : t(`state.${check.claim}`)}
      </p>
      <a
        className="btn btn--primary btn--block"
        href={`https://wallet.cashu.me/#token=${token}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        {t('token.claim')}
      </a>
      <div className="btn-row">
        <a className="btn btn--soft btn--sm" href={`cashu:${token}`}>
          {t('token.openWallet')}
        </a>
        <button
          type="button"
          className="btn btn--soft btn--sm"
          onClick={async () => flash((await copyText(token)) ? t('action.copied') : t('action.copyFailed'))}
        >
          {copied ?? t('token.copy')}
        </button>
      </div>
      <p className="warn">{t('bearer.warning')}</p>
    </div>
  )
}
