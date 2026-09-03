/**
 * WCAG 2.1 AA text-contrast scan (success criterion 1.4.3).
 *
 * Paste into the browser console on any page of the site, or run it through the
 * Browser pane's javascript_tool. Returns a result object rather than only
 * logging, so it can be read programmatically.
 *
 * Reports every text node whose colour fails against its resolved background:
 * 4.5:1 for normal text, 3:1 for large (>=24px, or >=18.66px bold).
 *
 * Three things it does that a naive scan gets wrong:
 *
 *  1. GRADIENTS ARE RESOLVED, NOT SKIPPED. This is the fix that matters. The
 *     earlier version treated any background-image as unmeasurable — and a
 *     Tailwind `bg-gradient-to-br` IS a background-image, so every gradient
 *     section was set aside as indeterminate and quietly passed. That is how
 *     the Contact strapline sat at 2.23:1 through a pass that reported nothing
 *     remaining. Gradient stops are now parsed out and the text is measured
 *     against the WORST of them, which is a safe bound: wherever the text
 *     actually sits on the ramp, it is at least this good.
 *
 *  2. Backgrounds are resolved by walking ANCESTORS, which breaks where Hero,
 *     Approach and Team paint a photo plus an absolutely-positioned overlay
 *     that is a SIBLING of the text, not a parent. A naive walk falls through
 *     to white and reports white-on-white. Those are still set aside as
 *     indeterminate — but they are now REPORTED as needing an eye, not
 *     silently dropped.
 *
 *  3. Semi-transparent colours are composited against the resolved background
 *     before measuring, so text-white/40 is judged as what it actually renders.
 *
 * It also runs a TYPE SIZE census. That is not a WCAG conformance item — the
 * spec mandates resize and reflow, not a minimum size — but 12px running text
 * is hard to read regardless of contrast, and the Brand Guidelines set 16px as
 * the web body size. Anything under 14px is reported, with uppercase tracked
 * labels called out separately since those are a deliberate device.
 *
 * Covers contrast and size. It says nothing about focus order, labels,
 * landmarks, alt text, heading structure or keyboard traps.
 */
(() => {
  const lum = ([r, g, b]) => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const parse = c => {
    const m = String(c).match(/[\d.]+/g)
    return m ? m.slice(0, 3).map(Number).concat(m[3] !== undefined ? +m[3] : 1) : null
  }
  const ratio = (a, b) => {
    const L1 = Math.max(lum(a), lum(b)), L2 = Math.min(lum(a), lum(b))
    return (L1 + 0.05) / (L2 + 0.05)
  }
  const over = (fg, bg, a) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)))

  /** Colour stops out of a computed linear/radial-gradient, in order. */
  const gradientStops = img => {
    const out = []
    const re = /rgba?\(([^)]+)\)/g
    let m
    while ((m = re.exec(img))) {
      const p = m[1].split(',').map(s => parseFloat(s))
      if (p.length >= 3) out.push({ rgb: p.slice(0, 3), a: p[3] === undefined ? 1 : p[3] })
    }
    return out.filter(s => s.a >= 0.9).map(s => s.rgb)
  }

  /**
   * Resolve what is actually behind this text.
   * Returns { grounds: rgb[], indeterminate: boolean }. More than one ground
   * means a gradient, and every one of them has to pass.
   */
  function groundsOf(el) {
    let n = el, photo = false
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n)
      const img = cs.backgroundImage

      if (img && img !== 'none') {
        if (/url\(/.test(img)) photo = true
        else {
          const stops = gradientStops(img)
          if (stops.length) return { grounds: stops, indeterminate: photo }
        }
      }

      // A painted overlay that is a sibling of the text, not an ancestor.
      if ([...n.children].some(c => {
        const s = getComputedStyle(c)
        return s.position === 'absolute'
          && (s.backgroundColor !== 'rgba(0, 0, 0, 0)' || s.backgroundImage !== 'none')
          && !c.contains(el)
      })) photo = true

      const bg = parse(cs.backgroundColor)
      if (bg && bg[3] >= 1) return { grounds: [bg.slice(0, 3)], indeterminate: photo }
      n = n.parentElement
    }
    return { grounds: [[255, 255, 255]], indeterminate: photo }
  }

  const fails = [], indeterminate = [], small = []
  const sizeCensus = {}
  let checked = 0

  document.querySelectorAll('body *').forEach(el => {
    const own = [...el.childNodes]
      .filter(n => n.nodeType === 3 && n.textContent.trim())
      .map(n => n.textContent.trim()).join(' ')
    const ph = el.getAttribute && el.getAttribute('placeholder')
    if (!own && !ph) return

    const box = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    if (!box.width || !box.height) return
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return

    const fg = parse(cs.color)
    if (!fg) return
    const { grounds, indeterminate: unsure } = groundsOf(el)

    const px = parseFloat(cs.fontSize)
    const weight = parseInt(cs.fontWeight) || 400
    const large = px >= 24 || (px >= 18.66 && weight >= 700)
    const needs = large ? 3 : 4.5

    // Worst ground wins — the text has to be legible everywhere it sits.
    let worst = Infinity, worstGround = null
    for (const g of grounds) {
      const r = ratio(over(fg.slice(0, 3), g, fg[3]), g)
      if (r < worst) { worst = r; worstGround = g }
    }

    const row = {
      text: (own || `placeholder: ${ph}`).slice(0, 60),
      selector: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string'
        ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''),
      px, weight, ratio: +worst.toFixed(2), needs,
      color: cs.color, on: `rgb(${worstGround.join(', ')})`,
      gradient: grounds.length > 1,
    }

    checked++

    // Size census, independent of contrast.
    const key = px + 'px/' + weight
    sizeCensus[key] = (sizeCensus[key] || 0) + 1
    if (px < 14) {
      const cs2 = cs
      small.push({
        text: row.text, px, weight,
        // An uppercase label with wide tracking is a deliberate device, not
        // running text, and reads differently at the same size.
        uppercaseLabel: cs2.textTransform === 'uppercase' && parseFloat(cs2.letterSpacing) > 0.4,
        selector: row.selector,
      })
    }

    if (worst < needs) (unsure ? indeterminate : fails).push(row)
    else if (unsure && worst < 7) indeterminate.push({ ...row, note: 'passes against the resolved ground, but a photo sits behind it' })
  })

  fails.sort((a, b) => a.ratio - b.ratio)
  small.sort((a, b) => a.px - b.px)
  return {
    url: location.pathname,
    checked,
    failing: fails.length,
    indeterminate: indeterminate.length,
    under14: small.length,
    fails,
    needsAnEye: indeterminate,
    tooSmall: small,
    sizeCensus,
  }
})()
