import { StyleSheet, Font } from '@react-pdf/renderer'
import jostLight from '../assets/fonts/Jost-300.ttf'
import jostMedium from '../assets/fonts/Jost-500.ttf'

/**
 * What every Wright Adventures PDF shares — Brand Guidelines v1.0 (Feb 2026).
 *
 * One place, because a second copy of the palette is a second thing to forget.
 * Registering the font family twice would also make each document carry the
 * work twice.
 *
 * Static TTFs are committed under src/assets/fonts: the site's Google Fonts
 * stylesheet serves a variable woff2, which fontkit will not read.
 */

// §4 Colour Palette
export const NAVY = '#004667' // Summit Navy — headings
export const RIVER = '#009DD6' // River Blue — accents
export const CHARCOAL = '#2D2D2D' // body text
export const CLOUD = '#F5F5F5' // subtle backgrounds
export const RULE = '#D8DCDF' // hairline, derived from Cloud for print

/**
 * River Blue is the brand's accent, but at 2.9:1 on white it fails AA as text
 * (§8 asks for sufficient contrast). It carries rules and marks; Navy carries
 * anything anyone has to read, and this grey carries the labels.
 */
export const LABEL_GRAY = '#5C6670'

Font.register({
  family: 'Jost',
  fonts: [
    { src: jostLight, fontWeight: 300 },
    { src: jostMedium, fontWeight: 500 },
  ],
})

// Free text should not hyphenate mid-word; it reads as a defect.
Font.registerHyphenationCallback(word => [word])

export const money = (v: number | string | null | undefined) =>
  `$${Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** 2026-09-01 → 1 September 2026, without pulling a date library into the PDF. */
export function longDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December']
  return `${d} ${months[m - 1]} ${y}`
}

/** "1 – 30 September 2026" rather than repeating a month and year that match. */
export function dateRange(from: string, to: string): string {
  const a = from.slice(0, 10).split('-')
  const b = to.slice(0, 10).split('-')
  if (a[0] === b[0] && a[1] === b[1]) return `${Number(a[2])} – ${longDate(to)}`
  if (a[0] === b[0]) return `${longDate(from).replace(` ${a[0]}`, '')} – ${longDate(to)}`
  return `${longDate(from)} – ${longDate(to)}`
}

/** 2026-09-02 → "2 Sep", for a dense column. */
export function shortDate(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d} ${months[m - 1]}`
}

/** The chrome every document repeats: page frame, §5 label treatment, footer. */
export const base = StyleSheet.create({
  page: {
    paddingHorizontal: 54,
    paddingTop: 48,
    paddingBottom: 72,
    fontFamily: 'Jost',
    fontWeight: 500,
    fontSize: 11,
    color: CHARCOAL,
    lineHeight: 1.4,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  logo: { width: 168 }, // §3 minimum is 150px digital / 1.5in print
  title: { fontSize: 18, color: NAVY, textAlign: 'right', letterSpacing: 3 },
  subtitle: { fontFamily: 'Jost', fontWeight: 300, fontSize: 12, color: NAVY, textAlign: 'right', marginTop: 3 },
  accent: { height: 3, backgroundColor: RIVER, marginTop: 22 },

  // §5 Highlights — Jost Light, uppercase
  label: {
    fontFamily: 'Jost', fontWeight: 300, fontSize: 9,
    color: LABEL_GRAY, textTransform: 'uppercase', letterSpacing: 1.4, marginBottom: 5,
  },
  strong: { fontSize: 12, color: NAVY },

  footer: {
    position: 'absolute', bottom: 38, left: 54, right: 54,
    borderTopWidth: 0.7, borderTopColor: RULE, paddingTop: 9,
    flexDirection: 'row', justifyContent: 'space-between',
    fontFamily: 'Jost', fontWeight: 300, fontSize: 8.5,
    color: LABEL_GRAY, textTransform: 'uppercase', letterSpacing: 1.1,
  },
})
