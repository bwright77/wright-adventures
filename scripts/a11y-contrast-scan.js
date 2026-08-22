/**
 * WCAG 2.1 AA text-contrast scan (success criterion 1.4.3).
 *
 * Paste into the browser console on any page of the site. Reports every text
 * node whose colour fails against its resolved background: 4.5:1 for normal
 * text, 3:1 for large (>=24px, or >=18.66px bold).
 *
 * Two things it does that a naive scan gets wrong:
 *
 *  1. Backgrounds are resolved by walking ANCESTORS, which breaks on our dark
 *     sections — Hero, Approach and Team paint a background image plus an
 *     absolutely-positioned overlay that is a SIBLING of the text, not a
 *     parent. A naive walk falls through to white and reports white-on-white,
 *     which produced 34 false failures on the home page. Those cases are
 *     detected and set aside as indeterminate rather than counted.
 *
 *  2. Semi-transparent colours are composited against the resolved background
 *     before measuring, so text-white/40 is judged as what it actually renders.
 *
 * Covers contrast only. It says nothing about focus order, labels, landmarks,
 * alt text or keyboard traps.
 */
(() => {
  const lum = ([r, g, b]) => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const parse = c => {
    const m = c.match(/[\d.]+/g)
    return m ? m.slice(0, 3).map(Number).concat(m[3] !== undefined ? +m[3] : 1) : null
  }
  const ratio = (a, b) => {
    const L1 = Math.max(lum(a), lum(b)), L2 = Math.min(lum(a), lum(b))
    return (L1 + 0.05) / (L2 + 0.05)
  }

  function bgOf(el) {
    let n = el, overlay = false
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n)
      if (cs.backgroundImage && cs.backgroundImage !== 'none') overlay = true
      if ([...n.children].some(c => {
        const s = getComputedStyle(c)
        return s.position === 'absolute'
          && (s.backgroundColor !== 'rgba(0, 0, 0, 0)' || s.backgroundImage !== 'none')
          && !c.contains(el)
      })) overlay = true
      const bg = parse(cs.backgroundColor)
      if (bg && bg[3] >= 1) return { bg: bg.slice(0, 3), overlay }
      n = n.parentElement
    }
    return { bg: [255, 255, 255], overlay }
  }

  const fails = [], indeterminate = []
  document.querySelectorAll('body *').forEach(el => {
    const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim())
      .map(n => n.textContent.trim()).join(' ')
    const ph = el.getAttribute && el.getAttribute('placeholder')
    if (!own && !ph) return

    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return

    const fg = parse(cs.color)
    if (!fg) return
    const { bg, overlay } = bgOf(el)
    const fgFlat = fg[3] < 1 ? fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3])) : fg.slice(0, 3)

    const size = parseFloat(cs.fontSize), weight = +cs.fontWeight || 400
    const need = (size >= 24 || (size >= 18.66 && weight >= 700)) ? 3 : 4.5
    const got = ratio(fgFlat, bg)
    if (got >= need) return

    const rec = {
      text: (own || 'placeholder: ' + ph).slice(0, 44),
      class: (el.className || '').toString().slice(0, 52),
      color: cs.color,
      bg: 'rgb(' + bg.map(Math.round).join(',') + ')',
      px: Math.round(size), weight,
      ratio: +got.toFixed(2), needs: need,
    }
    // Light text resolving to a light background means the real backdrop is an
    // image or overlay we could not see. Flag, don't fail.
    if (overlay || (lum(fgFlat) > 0.6 && lum(bg) > 0.9)) indeterminate.push(rec)
    else fails.push(rec)
  })

  console.log(`%cWCAG AA contrast — ${location.pathname}`, 'font-weight:bold')
  console.log(`${fails.length} failing, ${indeterminate.length} indeterminate (over image/overlay)`)
  if (fails.length) console.table(fails)
  return { failures: fails, indeterminate }
})()
