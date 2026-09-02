import { Document, Page, Text, View, Image, StyleSheet, pdf } from '@react-pdf/renderer'
import { BRAND } from '../data/siteData'
import logo from '../assets/images/wa_logo_horizontal_light.png'
import { NAVY, RIVER, CLOUD, RULE, LABEL_GRAY, base, longDate, dateRange, shortDate } from './pdfBrand'

/**
 * Hours worked over a period — what the CMC contract calls the checkpoint
 * review ("hours used, deliverables completed"), and what anyone else gets when
 * they ask where the time went.
 *
 * It is not an invoice and does not price anything: an hourly engagement's
 * money comes from the invoice, which stamps its own rates. Showing a total
 * here would be a second number to keep in step with the first.
 *
 * Estimated hours are shown but marked, and excluded from the tracked total.
 * They were recalled, not measured, and a report that quietly blends the two
 * invites someone to bill a guess.
 */

const s = StyleSheet.create({
  meta: {
    flexDirection: 'row', marginTop: 26,
    backgroundColor: CLOUD, paddingVertical: 12, paddingHorizontal: 16,
  },
  metaCell: { width: '34%' },

  // Columns are spaced with margins, not `gap`, and the figure carries an
  // explicit lineHeight — at 22pt the inherited 1.4 let Jost's descenders sit
  // on top of the sub-label underneath.
  summary: { flexDirection: 'row', marginTop: 22 },
  col: { marginRight: 36 },
  figure: { fontSize: 22, color: NAVY, lineHeight: 1.15 },
  figureSub: { fontFamily: 'Jost', fontWeight: 300, fontSize: 9, color: LABEL_GRAY, marginTop: 3 },
  people: { fontSize: 11, color: NAVY, lineHeight: 1.4, marginTop: 5 },

  tableHead: {
    flexDirection: 'row', marginTop: 26, paddingBottom: 7,
    borderBottomWidth: 1.2, borderBottomColor: NAVY,
  },
  row: { flexDirection: 'row', paddingVertical: 7, borderBottomWidth: 0.7, borderBottomColor: RULE },
  cDate: { width: '13%' },
  cWho: { width: '15%' },
  cDesc: { width: '58%', paddingRight: 10 },
  cHours: { width: '14%', textAlign: 'right' },

  flag: { fontFamily: 'Jost', fontWeight: 300, fontSize: 8.5, color: LABEL_GRAY },

  totalRow: {
    flexDirection: 'row', marginTop: 10, paddingTop: 10,
    borderTopWidth: 2, borderTopColor: RIVER,
  },
  totalLabel: {
    fontFamily: 'Jost', fontWeight: 300, fontSize: 10, color: NAVY,
    textTransform: 'uppercase', letterSpacing: 1.4,
  },
  totalValue: { fontSize: 14, color: NAVY, textAlign: 'right' },

  note: { marginTop: 24, fontSize: 9.5, color: LABEL_GRAY },
  empty: { marginTop: 30, fontSize: 11, color: LABEL_GRAY },
})

export interface TimeReportEntry {
  entry_date: string
  minutes: number
  description: string
  billable: boolean
  is_estimate: boolean
  who: string
}

export interface TimeReportData {
  organizationName: string
  engagementName: string
  from: string
  to: string
  entries: TimeReportEntry[]
  /** Hours left on the retainer, when the engagement has one. */
  retainerBalance?: number | null
  committedHours?: number | null
}

const hrs = (minutes: number) => (minutes / 60).toFixed(1)

export function TimeReportDocument({ report: r }: { report: TimeReportData }) {
  const rows = [...r.entries].sort(
    (a, b) => a.entry_date.localeCompare(b.entry_date) || a.who.localeCompare(b.who),
  )
  const tracked = rows.filter(e => !e.is_estimate)
  const totalMin = tracked.reduce((s, e) => s + e.minutes, 0)
  const billableMin = tracked.filter(e => e.billable).reduce((s, e) => s + e.minutes, 0)
  const estimateMin = rows.filter(e => e.is_estimate).reduce((s, e) => s + e.minutes, 0)

  // Who did what, only worth showing when it was not one person.
  const byPerson = new Map<string, number>()
  tracked.forEach(e => byPerson.set(e.who, (byPerson.get(e.who) ?? 0) + e.minutes))
  const people = [...byPerson.entries()].sort((a, b) => b[1] - a[1])

  return (
    <Document
      title={`Time — ${r.organizationName} — ${r.from} to ${r.to}`}
      author={BRAND.name}
      subject={`Hours on ${r.engagementName}`}
    >
      <Page size="LETTER" style={base.page}>
        <View style={base.headerRow} fixed>
          <Image src={logo} style={base.logo} />
          <View>
            <Text style={base.title}>TIME</Text>
            <Text style={base.subtitle}>{dateRange(r.from, r.to)}</Text>
          </View>
        </View>
        <View style={base.accent} />

        <View style={s.meta}>
          <View style={s.metaCell}>
            <Text style={base.label}>Client</Text>
            <Text style={base.strong}>{r.organizationName}</Text>
          </View>
          <View style={{ width: '66%' }}>
            <Text style={base.label}>Engagement</Text>
            <Text style={base.strong}>{r.engagementName}</Text>
          </View>
        </View>

        <View style={s.summary}>
          <View style={s.col}>
            <Text style={base.label}>Hours</Text>
            <Text style={s.figure}>{hrs(totalMin)}</Text>
          </View>
          <View style={s.col}>
            <Text style={base.label}>Billable</Text>
            <Text style={s.figure}>{hrs(billableMin)}</Text>
            {billableMin !== totalMin && (
              <Text style={s.figureSub}>{hrs(totalMin - billableMin)} non-billable</Text>
            )}
          </View>
          {r.retainerBalance != null && (
            <View style={s.col}>
              <Text style={base.label}>Retainer left</Text>
              <Text style={s.figure}>{r.retainerBalance.toFixed(1)}</Text>
              {r.committedHours != null && (
                <Text style={s.figureSub}>of {r.committedHours} committed</Text>
              )}
            </View>
          )}
          {people.length > 1 && (
            <View style={{ flex: 1 }}>
              <Text style={base.label}>By person</Text>
              <Text style={s.people}>
                {people.map(([who, m]) => `${who} ${hrs(m)}`).join('    ')}
              </Text>
            </View>
          )}
        </View>

        {rows.length === 0 ? (
          <Text style={s.empty}>No time logged in this period.</Text>
        ) : (
          <>
            <View style={s.tableHead} fixed>
              <Text style={[s.cDate, base.label, { marginBottom: 0 }]}>Date</Text>
              <Text style={[s.cWho, base.label, { marginBottom: 0 }]}>Who</Text>
              <Text style={[s.cDesc, base.label, { marginBottom: 0 }]}>Work</Text>
              <Text style={[s.cHours, base.label, { marginBottom: 0 }]}>Hours</Text>
            </View>

            {rows.map((e, i) => (
              <View key={i} style={s.row} wrap={false}>
                <Text style={s.cDate}>{shortDate(e.entry_date)}</Text>
                <Text style={s.cWho}>{e.who}</Text>
                <View style={s.cDesc}>
                  <Text>{e.description}</Text>
                  {(e.is_estimate || !e.billable) && (
                    <Text style={s.flag}>
                      {[e.is_estimate ? 'estimated' : null, !e.billable ? 'non-billable' : null]
                        .filter(Boolean).join(' · ')}
                    </Text>
                  )}
                </View>
                <Text style={s.cHours}>{hrs(e.minutes)}</Text>
              </View>
            ))}

            <View style={s.totalRow} wrap={false}>
              <Text style={[s.cDate, s.totalLabel]}>Total</Text>
              <View style={s.cWho} />
              <View style={s.cDesc}>
                {estimateMin > 0 && (
                  <Text style={s.flag}>
                    excludes {hrs(estimateMin)} estimated hours listed above
                  </Text>
                )}
              </View>
              <Text style={[s.cHours, s.totalValue]}>{hrs(totalMin)}</Text>
            </View>
          </>
        )}

        <Text style={s.note}>
          Time is recorded in six-minute increments, rounded up. Prepared {longDate(new Date().toISOString())}.
        </Text>

        <View style={base.footer} fixed>
          <Text>{BRAND.name}</Text>
          <Text>{r.organizationName}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}

/** Render to a Blob and hand it to the browser as a download. */
export async function downloadTimeReportPdf(report: TimeReportData) {
  const blob = await pdf(<TimeReportDocument report={report} />).toBlob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const slug = report.organizationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  a.download = `time-${slug}-${report.from}-to-${report.to}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
