import { Document, Page, Text, View, Image, StyleSheet, pdf } from '@react-pdf/renderer'
import { BRAND } from '../data/siteData'
import logo from '../assets/images/wa_logo_horizontal_light.png'
import { NAVY, RIVER, CLOUD, RULE, CHARCOAL, LABEL_GRAY, base, money, longDate, dateRange } from './pdfBrand'

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
 * Palette, type and the shared page chrome come from pdfBrand. Wording comes
 * from siteData, not from the guidelines document: the site is what clients
 * have actually seen, and the tagline differs between the two.
 */

const s = StyleSheet.create({
  panels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 26 },
  panel: { width: '47%' },

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

export function InvoiceDocument({ inv }: { inv: InvoicePdfData }) {
  return (
    <Document title={inv.invoice_number} author={BRAND.name} subject={`Invoice for ${inv.organizationName}`}>
      <Page size="LETTER" style={base.page}>
        <View style={base.headerRow}>
          <Image src={logo} style={base.logo} />
          <View>
            <Text style={base.title}>INVOICE</Text>
            <Text style={base.subtitle}>{inv.invoice_number}</Text>
          </View>
        </View>
        <View style={base.accent} />

        <View style={s.panels}>
          <View style={s.panel}>
            <Text style={base.label}>From</Text>
            <Text style={base.strong}>{BRAND.name}</Text>
            <Text>{BRAND.address}</Text>
            <Text>{BRAND.email}</Text>
            <Text>{BRAND.phone}</Text>
          </View>
          <View style={s.panel}>
            <Text style={base.label}>Bill to</Text>
            <Text style={base.strong}>{inv.organizationName}</Text>
            <Text>{inv.engagementName}</Text>
          </View>
        </View>

        <View style={s.meta}>
          <View style={s.metaCell}>
            <Text style={base.label}>Issued</Text>
            <Text>{longDate(inv.issue_date)}</Text>
          </View>
          <View style={s.metaCell}>
            <Text style={base.label}>Due</Text>
            <Text>{longDate(inv.due_date)}</Text>
          </View>
          {inv.period_start && inv.period_end && (
            <View style={s.metaCell}>
              <Text style={base.label}>Service period</Text>
              <Text>{dateRange(inv.period_start, inv.period_end)}</Text>
            </View>
          )}
        </View>

        <View style={s.tableHead}>
          <Text style={[s.cDesc, base.label, { marginBottom: 0 }]}>Description</Text>
          <Text style={[s.cQty, base.label, { marginBottom: 0 }]}>Hours</Text>
          <Text style={[s.cRate, base.label, { marginBottom: 0 }]}>Rate</Text>
          <Text style={[s.cAmt, base.label, { marginBottom: 0 }]}>Amount</Text>
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

        <View style={base.footer} fixed>
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
