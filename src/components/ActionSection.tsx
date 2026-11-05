import { useI18n } from '../i18n'
import type { Mode } from '../nav'
import { Burst } from './Burst'
import { MakeFlow } from './MakeFlow'
import { RedeemFlow } from './RedeemFlow'

/**
 * The home page's action card: Hide bitcoin in a photo, or Redeem one. The switch lives in the
 * top bar; both sides stay mounted, so an invoice in progress survives a look at Redeem.
 */
export function ActionSection({ mode, active }: { mode: Mode; active: boolean }) {
  const { t } = useI18n()
  return (
    <section className="make" id="make" aria-labelledby="make-title" data-mode={mode}>
      <div className="make-head">
        <h2 id="make-title">
          <Burst>{mode === 'hide' ? t('make.title') : t('redeem.title')}</Burst>
        </h2>
        <p>{mode === 'hide' ? t('make.sub') : t('redeem.sub')}</p>
      </div>
      <div hidden={mode !== 'hide'}>
        <MakeFlow active={active && mode === 'hide'} />
      </div>
      <div hidden={mode !== 'redeem'}>
        <RedeemFlow active={active && mode === 'redeem'} />
      </div>
    </section>
  )
}
