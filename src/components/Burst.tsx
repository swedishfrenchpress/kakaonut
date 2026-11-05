import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Kakao-style light burst behind a heading: yellow wedges fanning out from a point between the
 * lines (an X over two lines, a bow-tie under one). It measures the actual text lines, so the
 * shape hugs the words through wrapping, resizes, font loading and language switches.
 */
export function Burst({ children, animate = false }: { children: ReactNode; animate?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [lines, setLines] = useState(2)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const range = document.createRange()
      range.selectNodeContents(el)
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0)
      if (!rects.length) return
      const box = el.getBoundingClientRect()
      const left = Math.min(...rects.map((r) => r.left))
      const right = Math.max(...rects.map((r) => r.right))
      const top = Math.min(...rects.map((r) => r.top))
      const bottom = Math.max(...rects.map((r) => r.bottom))
      el.style.setProperty('--bx', `${left - box.left}px`)
      el.style.setProperty('--by', `${top - box.top}px`)
      el.style.setProperty('--bw', `${right - left}px`)
      el.style.setProperty('--bh', `${bottom - top}px`)
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || rects[0].height
      setLines(Math.max(1, Math.round((bottom - top) / lineHeight)))
    }
    measure()
    let live = true
    document.fonts?.ready.then(() => live && measure())
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      live = false
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [children])

  return (
    <span ref={ref} className={`burst${animate ? ' burst--animate' : ''}`} data-lines={lines > 1 ? 2 : 1}>
      {children}
    </span>
  )
}
