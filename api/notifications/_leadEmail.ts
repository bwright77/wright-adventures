// =============================================================================
// _leadEmail.ts — HTML + plain-text body for the "new lead" notification.
//
// Files prefixed `_` are ignored by Vercel's routing, so this is a helper and
// not an endpoint (same convention as _mailer.ts).
//
// Email HTML is not web HTML. Constraints that shape everything below:
//   • Inline styles only — Gmail strips <style> blocks.
//   • Tables for layout — flex and grid are unreliable across clients.
//   • No external assets — images are blocked by default in most clients.
//   • Plain-text alternative always sent alongside; some clients and most
//     accessibility tooling read that part.
// =============================================================================

export interface LeadEmailInput {
  role:            string
  employer:        string | null
  score:           number | null
  action:          string | null
  engagementType:  string | null
  compensation:    string | null
  location:        string | null
  closes:          string | null
  foundVia:        string | null
  rationale:       string | null
  postingUrl:      string | null
  appUrl:          string
}

const NAVY  = '#004667'
const RIVER = '#009DD6'
const TRAIL = '#4A7C59'
const MUTED = '#6b7280'
const LINE  = '#e5e7eb'

/** Badge colour follows the rubric band, so the verdict is legible at a glance. */
function actionStyle(action: string | null): { bg: string; fg: string; label: string } {
  switch (action) {
    case 'pursue_hard': return { bg: TRAIL,     fg: '#ffffff', label: 'Pursue hard' }
    case 'pursue_lean': return { bg: RIVER,     fg: '#ffffff', label: 'Pursue lean' }
    case 'monitor':     return { bg: '#fef3c7', fg: '#92400e', label: 'Monitor'     }
    default:            return { bg: '#f3f4f6', fg: MUTED,     label: 'Decline'     }
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function row(label: string, value: string | null): string {
  if (!value) return ''
  return `
    <tr>
      <td style="padding:10px 16px 10px 0;vertical-align:top;white-space:nowrap;
                 font:600 13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
                 color:${MUTED};">${esc(label)}</td>
      <td style="padding:10px 0;vertical-align:top;
                 font:400 14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
                 color:#111827;">${esc(value)}</td>
    </tr>`
}

export function buildLeadEmailHtml(d: LeadEmailInput): string {
  const badge = actionStyle(d.action)
  const scoreText = d.score != null ? `${d.score} / 21` : 'Not scored'

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5f7f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0"
             style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${LINE};border-radius:12px;overflow:hidden;">

        <!-- Header: employer first, because "who is hiring" is the first thing worth knowing -->
        <tr><td style="background:${NAVY};padding:22px 24px;">
          <div style="font:600 11px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
                      letter-spacing:.10em;text-transform:uppercase;color:rgba(255,255,255,.65);">
            New lead
          </div>
          <div style="font:700 21px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
                      color:#ffffff;margin-top:6px;">
            ${esc(d.employer ?? 'Organization not identified')}
          </div>
          <div style="font:400 15px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
                      color:rgba(255,255,255,.85);margin-top:3px;">
            ${esc(d.role)}
          </div>
        </td></tr>

        <!-- Verdict -->
        <tr><td style="padding:20px 24px 4px 24px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="background:${badge.bg};border-radius:6px;padding:7px 13px;
                       font:600 13px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
                       color:${badge.fg};">${esc(badge.label)}</td>
            <td style="padding-left:12px;
                       font:700 17px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
                       color:${NAVY};">${esc(scoreText)}</td>
          </tr></table>
        </td></tr>

        <!-- Fields -->
        <tr><td style="padding:8px 24px 4px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 style="border-collapse:collapse;">
            ${row('Organization', d.employer)}
            ${row('Role',         d.role)}
            ${row('Engagement',   d.engagementType)}
            ${row('Compensation', d.compensation)}
            ${row('Location',     d.location)}
            ${row('Closes',       d.closes)}
            ${row('Found via',    d.foundVia)}
          </table>
        </td></tr>

        ${d.rationale ? `
        <tr><td style="padding:12px 24px 4px 24px;">
          <div style="border-left:3px solid ${RIVER};background:#f8fafc;padding:14px 16px;border-radius:0 6px 6px 0;">
            <div style="font:600 11px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
                        letter-spacing:.08em;text-transform:uppercase;color:${MUTED};margin-bottom:7px;">
              Why it scored this way
            </div>
            <div style="font:400 14px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
                        color:#374151;">${esc(d.rationale)}</div>
          </div>
        </td></tr>` : ''}

        <!-- Actions -->
        <tr><td style="padding:20px 24px 24px 24px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="background:${NAVY};border-radius:8px;">
              <a href="${esc(d.appUrl)}/admin/leads"
                 style="display:inline-block;padding:11px 20px;text-decoration:none;
                        font:600 14px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
                        color:#ffffff;">Review in the OMP</a>
            </td>
            ${d.postingUrl ? `
            <td style="padding-left:10px;">
              <a href="${esc(d.postingUrl)}"
                 style="display:inline-block;padding:11px 18px;text-decoration:none;border:1px solid ${LINE};
                        border-radius:8px;
                        font:600 14px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
                        color:${NAVY};">View posting</a>
            </td>` : ''}
          </tr></table>
        </td></tr>

        <tr><td style="border-top:1px solid ${LINE};padding:14px 24px;">
          <a href="${esc(d.appUrl)}/admin/settings"
             style="font:400 12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
                    color:${MUTED};">Notification preferences</a>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`
}

/**
 * Plain-text alternative. Structure comes from blank lines and aligned labels —
 * markdown asterisks would render literally and defeat the purpose.
 */
export function buildLeadEmailText(d: LeadEmailInput): string {
  const badge = actionStyle(d.action)
  const field = (label: string, value: string | null): string | null =>
    value ? `${label.padEnd(14)}${value}` : null

  return [
    `${badge.label.toUpperCase()} — ${d.score != null ? `${d.score} / 21` : 'not scored'}`,
    '',
    (d.employer ?? 'Organization not identified').toUpperCase(),
    d.role,
    '',
    '─'.repeat(52),
    '',
    field('Organization', d.employer),
    '',
    field('Role',         d.role),
    '',
    field('Engagement',   d.engagementType),
    '',
    field('Compensation', d.compensation),
    '',
    field('Location',     d.location),
    '',
    field('Closes',       d.closes),
    '',
    field('Found via',    d.foundVia),
    '',
    '─'.repeat(52),
    '',
    d.rationale ? 'WHY IT SCORED THIS WAY' : null,
    d.rationale,
    '',
    '',
    d.postingUrl ? `Posting:   ${d.postingUrl}` : null,
    `Review:    ${d.appUrl}/admin/leads`,
    '',
    '',
    `Notification preferences: ${d.appUrl}/admin/settings`,
  ]
    .filter((l): l is string => l !== null)
    // Collapse blank-line runs left by absent fields, so a missing compensation
    // does not open a three-line gap.
    .reduce<string[]>((acc, line) => {
      if (line === '' && acc[acc.length - 1] === '') return acc
      acc.push(line)
      return acc
    }, [])
    .join('\n')
}
