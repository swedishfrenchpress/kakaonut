import { useEffect, useState } from 'react'
import { LogoMark } from './components/Logo'
import { Hero } from './components/Hero'
import { Footer } from './components/Footer'
import { MakeFlow } from './components/MakeFlow'
import { useI18n, type Lang } from './i18n'
import { TestScreen } from './screens/TestScreen'
import { OpenScreen } from './screens/OpenScreen'
import { HowScreen } from './screens/HowScreen'

type Page = 'make' | 'open' | 'test' | 'how'

function pageFromHash(): Page {
  if (location.hash === '#open') return 'open'
  if (location.hash === '#test') return 'test'
  if (location.hash === '#how') return 'how'
  return 'make' // '', '#make'
}

export function App() {
  const { t, lang, setLang } = useI18n()
  const [page, setPage] = useState<Page>(pageFromHash)

  useEffect(() => {
    const onHash = () => {
      const next = pageFromHash()
      setPage((prev) => {
        if (prev !== next && !(next === 'make' && location.hash === '#make')) window.scrollTo({ top: 0 })
        return next
      })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  return (
    <div className="app">
      <header className="top">
        <div className="top-row">
          <a className="brand" href="#" aria-label={t('app.name')}>
            <LogoMark size={36} />
            <span className="brand-name">
              {lang === 'ko' ? '카카오넛' : 'Kakaonut'}
            </span>
          </a>
          <div className="lang" role="group" aria-label={t('lang.switch')}>
            {(['en', 'ko'] as Lang[]).map((l) => (
              <button
                key={l}
                type="button"
                lang={l}
                aria-pressed={lang === l}
                className={lang === l ? 'is-on' : ''}
                onClick={() => setLang(l)}
              >
                {l === 'en' ? 'EN' : '한국어'}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Pages stay mounted so an invoice or finished photos survive switching pages. */}
      <main className="page page--make" hidden={page !== 'make'}>
        <Hero />
        <MakeFlow active={page === 'make'} />
      </main>
      <main className="page page--chat" hidden={page !== 'open'}>
        <OpenScreen active={page === 'open'} />
      </main>
      <main className="page page--chat" hidden={page !== 'test'}>
        <TestScreen active={page === 'test'} />
      </main>
      <main className="page page--how" hidden={page !== 'how'}>
        <HowScreen />
      </main>

      <Footer />
    </div>
  )
}
