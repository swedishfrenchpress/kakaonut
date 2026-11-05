/**
 * Talking to Cashu mints. cashu-ts is loaded on demand, so test mode and the first paint don't
 * pay for it. Never log tokens.
 */

export type ClaimState = 'unspent' | 'pending' | 'spent'

export interface TokenSummary {
  mint: string
  unit: string
  amount: number
}

type CashuModule = typeof import('@cashu/cashu-ts')
type WalletInstance = InstanceType<CashuModule['Wallet']>

let cashu: Promise<CashuModule> | undefined
const loadCashu = () => (cashu ??= import('@cashu/cashu-ts'))

const wallets = new Map<string, Promise<WalletInstance>>()

async function walletFor(mintUrl: string, unit: string): Promise<WalletInstance> {
  const key = `${mintUrl}|${unit}`
  let w = wallets.get(key)
  if (!w) {
    w = (async () => {
      const { Wallet } = await loadCashu()
      const wallet = new Wallet(mintUrl, { unit })
      await wallet.loadMint()
      return wallet
    })()
    wallets.set(key, w)
    w.catch(() => wallets.delete(key))
  }
  return w
}

export async function summarizeToken(token: string): Promise<TokenSummary> {
  const { getTokenMetadata } = await loadCashu()
  const meta = getTokenMetadata(token)
  return { mint: meta.mint, unit: meta.unit ?? 'sat', amount: Number(meta.amount.toString()) }
}

/** Asks the mint whether the token's proofs are spent. Worst state wins. */
export async function checkClaimState(token: string): Promise<ClaimState> {
  const summary = await summarizeToken(token)
  const wallet = await walletFor(summary.mint, summary.unit)
  const states = await wallet.checkProofsStates(wallet.decodeToken(token).proofs)
  if (states.some((s) => s.state === 'SPENT')) return 'spent'
  if (states.some((s) => s.state === 'PENDING')) return 'pending'
  return 'unspent'
}

export function mintHost(mintUrl: string): string {
  try {
    const u = new URL(mintUrl)
    return u.host + (u.pathname === '/' ? '' : u.pathname)
  } catch {
    return mintUrl
  }
}

/* ---------- Making: invoice → paid → token ---------- */

export const MINTS = {
  test: 'https://testnut.cashu.space',
  real: 'https://mint.minibits.cash/Bitcoin',
} as const
export type MintChoice = keyof typeof MINTS

export function isTestMint(mintUrl: string): boolean {
  return /testnut/i.test(mintUrl)
}

export interface Invoice {
  quote: string
  /** bolt11 */
  request: string
}

export async function createInvoice(mintUrl: string, amount: number): Promise<Invoice> {
  const wallet = await walletFor(mintUrl, 'sat')
  const q = await wallet.createMintQuoteBolt11(amount, 'Kakaonut')
  return { quote: q.quote, request: q.request }
}

export type QuoteState = 'UNPAID' | 'PAID' | 'ISSUED'

export async function invoiceState(mintUrl: string, quote: string): Promise<QuoteState> {
  const wallet = await walletFor(mintUrl, 'sat')
  const s = await wallet.checkMintQuoteBolt11(quote)
  return String(s.state) as QuoteState
}

/** Mints the proofs for a paid quote and returns them as a compact token (no DLEQ). */
export async function mintToken(mintUrl: string, amount: number, quote: string): Promise<string> {
  const cashuTs = await loadCashu()
  const wallet = await walletFor(mintUrl, 'sat')
  const proofs = await wallet.mintProofsBolt11(amount, quote)
  return cashuTs.getEncodedToken({ mint: mintUrl, proofs, unit: 'sat', memo: 'Kakaonut' }, { removeDleq: true })
}
