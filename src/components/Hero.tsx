import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { prefersReducedMotion } from '../hooks'
import { HeroPhoto, HeroXray } from './HeroPhoto'
import { Burst } from './Burst'
import { goToMode } from '../nav'

/**
 * Hero: a KakaoTalk-style chat on a phone. A photo is sent, x-rayed, and the hidden sats pop out.
 * Plays as a loop of timed steps; with reduced motion it shows the last frame only.
 */

const POP_AMOUNT = 20000

// Step → when it starts (ms from the start of the loop).
const TIMELINE = [
  0, //    0: empty chat (date chip)
  500, //  1: friend's message
  1500, // 2: my text
  2300, // 3: my photo, sending
  3000, // 4: photo sent
  3700, // 5: x-ray scan
  5300, // 6: coins revealed
  5900, // 7: +20,000 sats pops
  7200, // 8: friend replies
]
const LOOP_MS = 10_800
const LAST = TIMELINE.length - 1

export function Hero() {
  const { t, num, lang } = useI18n()
  const [step, setStep] = useState(() => (prefersReducedMotion() ? LAST : 0))
  const [cycle, setCycle] = useState(0)
  const [inView, setInView] = useState(false)
  const phone = useRef<HTMLDivElement>(null)

  // Only play while the phone is on screen, so nobody misses the pop.
  useEffect(() => {
    const el = phone.current
    if (!el || typeof IntersectionObserver === 'undefined') return setInView(true)
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.45 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (prefersReducedMotion()) return
    if (!inView) {
      setStep(0)
      return
    }
    const timers = TIMELINE.map((at, i) => setTimeout(() => setStep(i), at))
    timers.push(
      setTimeout(() => {
        setStep(-1) // fade everything out, then start again
        setTimeout(() => setCycle((c) => c + 1), 450)
      }, LOOP_MS),
    )
    return () => timers.forEach(clearTimeout)
  }, [cycle, inView])

  const now = new Date()
  const time = new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit' }).format(now)
  const date = new Intl.DateTimeFormat(lang, { dateStyle: 'full' }).format(now)
  const read = step >= 7

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <h1 id="hero-title" className="hero-title">
          <Burst animate>{t('hero.title')}</Burst>
        </h1>
        <p className="hero-sub">{t('hero.sub')}</p>
        <div className="hero-ctas">
          <a className="btn btn--primary btn--lg" href="#hide" onClick={(e) => goToMode('hide', e)}>
            {t('hero.hide')}
          </a>
          <a className="btn btn--ink btn--lg" href="#redeem" onClick={(e) => goToMode('redeem', e)}>
            {t('hero.redeem')}
          </a>
        </div>
      </div>

      <div className="hero-stage">
        <Bubble className="deco deco--a" />
        <Bubble className="deco deco--b" />
        <Bubble className="deco deco--c" />

        <div className="phone" ref={phone} role="img" aria-label={t('chat.label', { amount: num(POP_AMOUNT) })}>
          <div className="phone-screen" aria-hidden="true">
            <div className="kt-status">
              <span>9:41</span>
              <span className="kt-status-icons">
                <i />
                <i />
                <i />
              </span>
            </div>
            <div className="kt-head">
              <span className="kt-back">‹</span>
              <span className="kt-title">{t('chat.friend')}</span>
              <span className="kt-head-icons">
                <SearchIcon />
                <MenuIcon />
              </span>
            </div>

            <div className={`kt-room${step < 0 ? ' is-fading' : ''}`} key={cycle}>
              <div className="kt-date">{date}</div>

              {step >= 1 && (
                <div className="kt-row kt-row--them">
                  <span className="kt-avatar">🐰</span>
                  <div className="kt-col">
                    <span className="kt-name">{t('chat.friend')}</span>
                    <div className="kt-line">
                      <span className="kt-bubble kt-bubble--them">{t('chat.m1')}</span>
                      <span className="kt-meta">{time}</span>
                    </div>
                  </div>
                </div>
              )}

              {step >= 2 && (
                <div className="kt-row kt-row--me">
                  <div className="kt-line">
                    <span className="kt-meta">
                      {!read && <b className="kt-unread">1</b>}
                      {time}
                    </span>
                    <span className="kt-bubble kt-bubble--me">{t('chat.m2')}</span>
                  </div>
                </div>
              )}

              {step >= 3 && (
                <div className="kt-row kt-row--me">
                  <div className="kt-line">
                    <span className="kt-meta">
                      {!read && step >= 4 && <b className="kt-unread">1</b>}
                      {step >= 4 && time}
                    </span>
                    <div
                      className={[
                        'kt-photo',
                        step === 3 && 'is-sending',
                        step === 5 && 'is-scanning',
                        step >= 6 && 'is-revealed',
                        step >= 7 && 'is-popped',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <div className="kt-photo-clip">
                        <HeroPhoto />
                        <div className="kt-xray">
                          <HeroXray />
                        </div>
                        <div className="kt-scanline">
                          <span>{t('chat.xray')}</span>
                        </div>
                        {step === 3 && <div className="kt-sending" />}
                      </div>
                      {step >= 7 && (
                        <>
                          <div className="kt-pop">
                            <span className="kt-pop-coin">₿</span>
                            {t('chat.pop', { amount: num(POP_AMOUNT) })}
                          </div>
                          <div className="kt-burst">
                            {Array.from({ length: 8 }, (_, i) => (
                              <i key={i} style={{ ['--a' as string]: `${i * 45}deg` }} />
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {step >= 8 && (
                <div className="kt-row kt-row--them">
                  <span className="kt-avatar">🐰</span>
                  <div className="kt-col">
                    <span className="kt-name">{t('chat.friend')}</span>
                    <div className="kt-line">
                      <span className="kt-bubble kt-bubble--them">{t('chat.m3')}</span>
                      <span className="kt-meta">{time}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="kt-input">
              <span className="kt-plus">+</span>
              <span className="kt-field" />
              <span className="kt-send">{t('chat.send')}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Bubble({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 200 180" aria-hidden="true">
      <path d="M100 8 C156 8 196 42 196 86 C196 130 156 162 100 162 C90 162 80 161 71 159 L34 178 L44 146 C20 132 4 110 4 86 C4 42 44 8 100 8 Z" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 L21 21" strokeLinecap="round" />
    </svg>
  )
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M4 6 H20 M4 12 H20 M4 18 H20" />
    </svg>
  )
}
