// ── Phone normalization utilities ──────────────────────────────
// Handles US numbers (10 digits, or 11 digits starting with 1).
// Non-US numbers are returned trimmed as-is.

/** Returns display format: (XXX) XXX-XXXX, or the original trimmed string if unrecognized. */
export function normalizePhone(raw: string): string {
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (local.length === 10) {
    return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`
  }
  return raw.trim()
}

/** Returns an E.164-style tel: href, e.g. tel:+17207231888 */
export function toTelHref(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (local.length === 10) return `tel:+1${local}`
  return `tel:${phone.trim()}`
}
