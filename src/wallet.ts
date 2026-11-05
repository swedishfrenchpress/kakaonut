import { loadJson, removeKey, saveJson } from './storage'

/**
 * What must survive a reload: the invoice being paid, and every token minted. Tokens are bearer
 * money, so they are saved before they're hidden in a photo, and never logged.
 */

export interface PendingQuote {
  mint: string
  amount: number
  quote: string
  request: string
  createdAt: number
  edge: number
}

export interface SavedToken {
  id: string
  token: string
  mint: string
  amount: number
  createdAt: number
}

const PENDING = 'kakaonut.pending'
const TOKENS = 'kakaonut.tokens'

export const loadPending = (): PendingQuote | null => loadJson<PendingQuote | null>(PENDING, null)
export const savePending = (p: PendingQuote): boolean => saveJson(PENDING, p)
export const clearPending = (): void => removeKey(PENDING)

export function loadTokens(): SavedToken[] {
  const list = loadJson<SavedToken[]>(TOKENS, [])
  return Array.isArray(list) ? list : []
}

/** Returns false if the token could not be stored: the caller must show it to the user right away. */
export function addToken(t: SavedToken): boolean {
  const list = loadTokens().filter((x) => x.id !== t.id)
  return saveJson(TOKENS, [t, ...list])
}

export function deleteToken(id: string): boolean {
  return saveJson(
    TOKENS,
    loadTokens().filter((x) => x.id !== id),
  )
}
