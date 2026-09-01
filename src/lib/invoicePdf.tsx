import { Document, Page, Text, View, Image, StyleSheet, Font, pdf } from '@react-pdf/renderer'
import { BRAND } from '../data/siteData'
import logo from '../assets/images/wa_logo_horizontal_light.png'
import jostLight from '../assets/fonts/Jost-300.ttf'
import jostMedium from '../assets/fonts/Jost-500.ttf'

/**
 * The invoice as the client receives it.
 *
 * Rendered client-side, matching the ADR-004 precedent for the DOCX export —
 * there is no server-side rendering step to maintain, and the data is already
 * in the browser.
 *
 * It renders from what was SAVED on the invoice, never recomputed from time
 * entries or the engagement. A sent invoice is a statement of fact; if a rate
 * changes or an entry is edited afterwards, the document must not quietly say
 * something different from what was issued.
 *
 * Typography and colour follow the Brand Guidelines v1.0 (Feb 2026): Jost, two
 * weights, with Medium carrying content and Light-uppercase carrying labels.
 * The static TTFs are committed under src/assets/fonts because the site's
 * Google Fonts stylesheet serves a variable woff2, which fontkit will not read.
 *
 * Wording comes from siteData, not from the guidelines document: the site is
 * what clients have actually seen, and the tagline differs between the two.
 */

// §4 Colour Palette
const NAVY = '#004667' // Summit Navy — headings
const RIVER = '#009DD6' // River Blue — accents
const CHARCOAL = '#2D2D2D' // body text
const CLOUD = '#F5F5F5' // subtle backgrounds
const RULE = '#D8DCDF' // hairline, derived from Cloud for print

/**
 * River Blue is the brand's accent, but at 2.9:1 on white it fails AA as text
 * (§8 asks for sufficient contrast). It carries the rules and the mark here,
 * and Navy carries anything anyone has to read.
 */
const LABEL_GRAY = '#5C6670'

Font.register({
  family: 'Jost',
  fonts: [
    { src: jostLight, fontWeight: 300 },
    { src: jostMedium, fontWeight: 500 },
  ],
})

// Descriptions are free text; hyphenating "Stewardship" mid-word looks like a defect.
Font.registerHyphenationCallback(word => [word])

const s = StyleSheet.create({
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
  number: { fontFamily: 'Jost', fontWeight: 300, fontSize: 12, color: NAVY, textAlign: 'right', marginTop: 3 },
  accent: { height: 3, backgroundColor: RIVER, marginTop: 22 },

  panels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 26 },
  panel: { width: '47%' },

  // §5 Highlights — Jost Light, uppercase
  label: {
    fontFamily: 'Jost', fontWeight: 300, fontSize: 9,
    color: LABEL_GRAY, textTransform: 'uppercase', letterSpacing: 1.4, marginBottom: 5,
  },
  strong: { fontSize: 12, color: NAVY },

  meta: {
    flexDirection: 'row', marginTop: 26,
    backgroundColor: CLOUD, paddingVertical: 12, paddingHorizontal: 16,
  },
  metaCell: { width: '34%' },

  tableHead: {
    flexDirection: 'row', marginTop: 30, paddingBottom: 7,
    borderBottomWidth: 1.2, borderBottomColor: NAVY,
  },
  row: { flexDirection: 'row', paddingVertical: 9, borderBottomWidth: 0.7, borderBottomColor: RULE },
  cDesc: { width: '58%', paddingRight: 10 },
  cQty: { width: '13%', textAlign: 'right' },
  cRate: { width: '14%', textAlign: 'right' },
  cAmt: { width: '15%', textAlign: 'right' },

  totals: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16 },
  totalBox: { width: '46%' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  totalDue: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 8, paddingTop: 10, borderTopWidth: 2, borderTopColor: RIVER,
  },
  dueLabel: {
    fontFamily: 'Jost', fontWeight: 300, fontSize: 10, color: NAVY,
    textTransform: 'uppercase', letterSpacing: 1.4,
  },
  dueAmount: { fontSize: 16, color: NAVY },

  notes: { marginTop: 30, fontSize: 10, color: LABEL_GRAY },
  terms: { marginTop: 8, fontSize: 10, color: CHARCOAL },

  footer: {
    position: 'absolute', bottom: 38, left: 54, right: 54,
    borderTopWidth: 0.7, borderTopColor: RULE, paddingTop: 9,
    flexDirection: 'row', justifyContent: 'space-between',
    fontFamily: 'Jost', fontWeight: 300, fontSize: 8.5,
    color: LABEL_GRAY, textTransform: 'uppercase', letterSpacing: 1.1,
  },
})

export interface InvoicePdfData {
  invoice_number: string
  issue_date: string
  due_date: string
  period_start: string | null
  period_end: string | null
  subtotal: number | string
  total: number | string
  notes: string | null
  status: string
  engagementName: string
  organizationName: string
  lines: Array<{
    description: string
    quantity: number | string
    unit_rate: number | string
    amount: number | string
    line_type: string
  }>
}

const money = (v: number | string | null | undefined) =>
  `$${Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** 2026-09-01 → 1 September 2026, without pulling a date library into the PDF. */
function longDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December']
  return `${d} ${months[m - 1]} ${y}`
}

/** "1 – 30 September 2026" rather than repeating a month and year that match. */
function dateRange(from: string, to: string): string {
  const a = from.slice(0, 10).split('-')
  const b = to.slice(0, 10).split('-')
  if (a[0] === b[0] && a[1] === b[1]) return `${Number(a[2])} – ${longDate(to)}`
  if (a[0] === b[0]) return `${longDate(from).replace(` ${a[0]}`, '')} – ${longDate(to)}`
  return `${longDate(from)} – ${longDate(to)}`
}

export function InvoiceDocument({ inv }: { inv: InvoicePdfData }) {
  return (
    <Document title={inv.invoice_number} author={BRAND.name} subject={`Invoice for ${inv.organizationName}`}>
      <Page size="LETTER" style={s.page}>
        <View style={s.headerRow}>
          <Image src={logo} style={s.logo} />
          <View>
            <Text style={s.title}>INVOICE</Text>
            <Text style={s.number}>{inv.invoice_number}</Text>
          </View>
        </View>
        <View style={s.accent} />

        <View style={s.panels}>
          <View style={s.panel}>
            <Text style={s.label}>From</Text>
            <Text style={s.strong}>{BRAND.name}</Text>
            <Text>{BRAND.address}</Text>
            <Text>{BRAND.email}</Text>
            <Text>{BRAND.phone}</Text>
          </View>
          <View style={s.panel}>
            <Text style={s.label}>Bill to</Text>
            <Text style={s.strong}>{inv.organizationName}</Text>
            <Text>{inv.engagementName}</Text>
          </View>
        </View>

        <View style={s.meta}>
          <View style={s.metaCell}>
            <Text style={s.label}>Issued</Text>
            <Text>{longDate(inv.issue_date)}</Text>
          </View>
          <View style={s.metaCell}>
            <Text style={s.label}>Due</Text>
            <Text>{longDate(inv.due_date)}</Text>
          </View>
          {inv.period_start && inv.period_end && (
            <View style={s.metaCell}>
              <Text style={s.label}>Service period</Text>
              <Text>{dateRange(inv.period_start, inv.period_end)}</Text>
            </View>
          )}
        </View>

        <View style={s.tableHead}>
          <Text style={[s.cDesc, s.label, { marginBottom: 0 }]}>Description</Text>
          <Text style={[s.cQty, s.label, { marginBottom: 0 }]}>Hours</Text>
          <Text style={[s.cRate, s.label, { marginBottom: 0 }]}>Rate</Text>
          <Text style={[s.cAmt, s.label, { marginBottom: 0 }]}>Amount</Text>
        </View>

        {inv.lines.map((l, i) => {
          // A retainer line is a fee, not an hourly computation. Printing
          // "1 × $6,000" invites the reader to check arithmetic that is not
          // what was agreed.
          const isFee = l.line_type === 'retainer' || l.line_type === 'fixed_fee'
          return (
            <View key={i} style={s.row} wrap={false}>
              <Text style={s.cDesc}>{l.description}</Text>
              <Text style={s.cQty}>{isFee ? '—' : Number(l.quantity).toFixed(1)}</Text>
              <Text style={s.cRate}>{isFee ? '—' : money(l.unit_rate)}</Text>
              <Text style={s.cAmt}>{money(l.amount)}</Text>
            </View>
          )
        })}

        <View style={s.totals} wrap={false}>
          <View style={s.totalBox}>
            <View style={s.totalRow}>
              <Text style={{ color: LABEL_GRAY }}>Subtotal</Text>
              <Text>{money(inv.subtotal)}</Text>
            </View>
            <View style={s.totalDue}>
              <Text style={s.dueLabel}>Amount due</Text>
              <Text style={s.dueAmount}>{money(inv.total)}</Text>
            </View>
          </View>
        </View>

        {inv.notes && <Text style={s.notes}>{inv.notes}</Text>}
        <Text style={s.terms}>
          Payment due {longDate(inv.due_date)}. Please reference {inv.invoice_number} with remittance.
        </Text>

        <View style={s.footer} fixed>
          <Text>{BRAND.name}</Text>
          <Text>{BRAND.tagline}</Text>
          <Text>{inv.invoice_number}</Text>
        </View>
      </Page>
    </Document>
  )
}

/** Render to a Blob and hand it to the browser as a download. */
export async function downloadInvoicePdf(inv: InvoicePdfData) {
  const blob = await pdf(<InvoiceDocument inv={inv} />).toBlob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${inv.invoice_number}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
