import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  BorderStyle,
  HeadingLevel,
  AlignmentType,
  WidthType,
} from 'docx'
import type { BoardMeeting, BoardMeetingExtractedData } from '../types'
import { format } from 'date-fns'

// ── Helpers ───────────────────────────────────────────────────

function heading(text: string): Paragraph {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
  })
}

function body(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, size: 22 })],
    spacing: { after: 80 },
  })
}

function bold(text: string): TextRun {
  return new TextRun({ text, bold: true, size: 22 })
}

function normal(text: string): TextRun {
  return new TextRun({ text, size: 22 })
}

function divider(): Paragraph {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC', space: 0 } },
    spacing: { after: 160 },
  })
}

// ── Main export function ──────────────────────────────────────

export async function exportMinutesDocx(
  meeting: Pick<BoardMeeting, 'id' | 'meeting_date' | 'location' | 'approved_by' | 'approved_at' | 'approver'>,
  data: BoardMeetingExtractedData,
): Promise<Blob> {
  const meetingDateDisplay = data.meeting_info.date
    ? format(new Date(data.meeting_info.date + 'T12:00:00'), 'MMMM d, yyyy')
    : format(new Date(meeting.meeting_date + 'T12:00:00'), 'MMMM d, yyyy')

  const children: (Paragraph | Table)[] = []

  // ── Letterhead ──────────────────────────────────────────────
  children.push(
    new Paragraph({
      children: [new TextRun({ text: 'Confluence Colorado', bold: true, size: 28 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'A Program of Wright Adventures', size: 20, color: '555555' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 280 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'BOARD MEETING MINUTES', bold: true, size: 28 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `${meetingDateDisplay}  |  ${data.meeting_info.location}`, size: 22, color: '555555' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 320 },
    }),
    divider(),
  )

  // ── Attendance ──────────────────────────────────────────────
  children.push(heading('ATTENDANCE'))

  const att = data.attendance
  children.push(
    new Paragraph({
      children: [bold('Directors Present:  '), normal(att.directors_present.join(', ') || 'Not recorded')],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [bold('Directors Absent:  '), normal(att.directors_absent.join(', ') || 'None')],
      spacing: { after: 80 },
    }),
  )

  if (att.guests.length > 0) {
    children.push(
      new Paragraph({
        children: [bold('Guests:  '), normal(att.guests.join(', '))],
        spacing: { after: 80 },
      }),
    )
  }

  const quorumText = att.quorum_met === true
    ? `Met (${att.directors_present.length} director${att.directors_present.length !== 1 ? 's' : ''} present)`
    : att.quorum_met === false
    ? 'Not met'
    : `Unknown — ${att.quorum_note ?? 'see AI flags'}`
  children.push(
    new Paragraph({
      children: [bold('Quorum:  '), normal(quorumText)],
      spacing: { after: 160 },
    }),
  )

  // ── Call to Order ────────────────────────────────────────────
  children.push(heading('CALL TO ORDER'))
  const orderText = [
    data.meeting_info.start_time ? `Meeting called to order at ${data.meeting_info.start_time}` : 'Meeting called to order',
    data.meeting_info.called_to_order_by ? ` by ${data.meeting_info.called_to_order_by}.` : '.',
  ].join('')
  children.push(body(orderText))

  // ── Approval of Prior Minutes ────────────────────────────────
  children.push(heading('APPROVAL OF PRIOR MINUTES'))
  if (data.prior_minutes.reviewed) {
    const approvalText = data.prior_minutes.approved
      ? 'Prior minutes were reviewed and approved.'
      : 'Prior minutes were reviewed.'
    children.push(body(data.prior_minutes.corrections
      ? `${approvalText} Corrections noted: ${data.prior_minutes.corrections}`
      : approvalText,
    ))
  } else {
    children.push(body('Prior minutes were not reviewed at this meeting.'))
  }

  // ── Reports ──────────────────────────────────────────────────
  if (data.reports.length > 0) {
    children.push(heading('REPORTS'))
    for (const report of data.reports) {
      children.push(
        new Paragraph({
          children: [bold(`${report.title}`), normal(report.presenter ? ` — ${report.presenter}` : '')],
          spacing: { before: 120, after: 60 },
        }),
        body(report.summary),
      )
    }
  }

  // ── Motions ──────────────────────────────────────────────────
  if (data.motions.length > 0) {
    children.push(heading('MOTIONS'))
    for (const motion of data.motions) {
      children.push(
        new Paragraph({
          children: [bold(`Motion ${motion.id}: `), normal(motion.description)],
          spacing: { before: 120, after: 60 },
        }),
        new Paragraph({
          children: [
            bold('  Moved by: '), normal(motion.moved_by || 'Unknown'),
            normal('  |  '),
            bold('Seconded by: '), normal(motion.seconded_by || 'Unknown'),
          ],
          spacing: { after: 60 },
        }),
      )
      if (motion.discussion_summary) {
        children.push(
          new Paragraph({
            children: [bold('  Discussion: '), normal(motion.discussion_summary)],
            spacing: { after: 60 },
          }),
        )
      }
      const voteText = [
        `Yes — ${motion.vote.yes ?? '?'}`,
        `No — ${motion.vote.no ?? '?'}`,
        `Abstain — ${motion.vote.abstain ?? '?'}`,
        `RESULT: ${motion.vote.result}`,
      ].join('  |  ')
      children.push(
        new Paragraph({
          children: [bold('  Vote: '), normal(voteText)],
          spacing: { after: 120 },
        }),
      )
    }
  }

  // ── Action Items ─────────────────────────────────────────────
  if (data.action_items.length > 0) {
    children.push(heading('ACTION ITEMS'))

    const tableRows = [
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ children: [bold('Description')] })] }),
          new TableCell({ children: [new Paragraph({ children: [bold('Assigned To')] })] }),
          new TableCell({ children: [new Paragraph({ children: [bold('Due Date')] })] }),
        ],
        tableHeader: true,
      }),
      ...data.action_items.map(item =>
        new TableRow({
          children: [
            new TableCell({ children: [body(item.description)] }),
            new TableCell({ children: [body(item.assigned_to)] }),
            new TableCell({ children: [body(item.due_date ?? 'TBD')] }),
          ],
        }),
      ),
    ]

    children.push(
      new Table({
        rows: tableRows,
        width: { size: 100, type: WidthType.PERCENTAGE },
      }),
    )
  }

  // ── Next Meeting ─────────────────────────────────────────────
  if (data.next_meeting.date || data.next_meeting.time || data.next_meeting.location) {
    children.push(heading('NEXT MEETING'))
    const parts = [
      data.next_meeting.date ? format(new Date(data.next_meeting.date + 'T12:00:00'), 'MMMM d, yyyy') : null,
      data.next_meeting.time,
      data.next_meeting.location,
    ].filter(Boolean)
    children.push(body(parts.join('  ·  ')))
  }

  // ── Adjournment ──────────────────────────────────────────────
  children.push(heading('ADJOURNMENT'))
  children.push(body(
    data.adjournment_time
      ? `Meeting adjourned at ${data.adjournment_time}.`
      : 'Meeting adjourned.',
  ))

  // ── Approval signature line ──────────────────────────────────
  children.push(divider())

  const approverName = meeting.approver?.full_name ?? 'Board Approver'
  const approvedDate = meeting.approved_at
    ? format(new Date(meeting.approved_at), 'MMMM d, yyyy')
    : ''

  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: '_'.repeat(40), size: 22 }),
        new TextRun({ text: '    ' }),
        new TextRun({ text: '_'.repeat(20), size: 22 }),
      ],
      spacing: { before: 360, after: 60 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: `Approved by: ${approverName}`, size: 20, color: '555555' }),
        new TextRun({ text: `    Date: ${approvedDate}`, size: 20, color: '555555' }),
      ],
      spacing: { after: 80 },
    }),
  )

  // ── Build document ───────────────────────────────────────────
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 },
          },
        },
        children,
      },
    ],
  })

  const buffer = await Packer.toBlob(doc)
  return buffer
}
