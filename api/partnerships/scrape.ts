import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'

// ── Clients ───────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// ── Logo extraction ───────────────────────────────────────────
function extractLogoUrl(html: string, baseUrl: string): string | null {
  const base = new URL(baseUrl)
  const origin = base.origin

  function resolve(href: string): string {
    try {
      return new URL(href, origin).href
    } catch {
      return href
    }
  }

  // 1. og:image
  const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
  if (ogImage?.[1]) return resolve(ogImage[1])

  // 2. apple-touch-icon
  const touchIcon = html.match(/<link[^>]+rel=["']apple-touch-icon["'][^>]+href=["']([^"']+)["']/i)
    ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']apple-touch-icon["']/i)
  if (touchIcon?.[1]) return resolve(touchIcon[1])

  // 3. PNG icon
  const pngIcon = html.match(/<link[^>]+rel=["']icon["'][^>]+type=["']image\/png["'][^>]+href=["']([^"']+)["']/i)
    ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]+type=["']image\/png["'][^>]+rel=["']icon["']/i)
  if (pngIcon?.[1]) return resolve(pngIcon[1])

  // 4. shortcut icon
  const shortcutIcon = html.match(/<link[^>]+rel=["']shortcut icon["'][^>]+href=["']([^"']+)["']/i)
    ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']shortcut icon["']/i)
  if (shortcutIcon?.[1]) return resolve(shortcutIcon[1])

  // 5. Google Favicon fallback
  return `https://www.google.com/s2/favicons?domain=${base.hostname}&sz=64`
}

// ── HTML → plain text ─────────────────────────────────────────
function extractPageText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20000)
}

// ── Extraction prompt ─────────────────────────────────────────
const SYSTEM = `You are a structured data extraction assistant. Given web page text for an
organization — whether a nonprofit, government agency, foundation, or for-profit company —
extract key contact and opportunity fields and return them as a JSON object. Only include
fields you are confident about — omit fields where the information is missing or ambiguous.
Never invent data.`

function buildPrompt(pageText: string): string {
  return `Extract the following fields from this web page text. Return a single JSON object
with only the fields you can confidently identify. Omit any field where the information
is absent or unclear.

Fields to extract:
- organization_name: string — the name of the organization
- primary_contact_name: string — the name of the main contact person
- primary_contact_title: string — their title or role
- contact_email: string — their email address
- contact_phone: string — their phone number
- project_description: string — a clear description of the organization, project, or engagement scope (2-4 sentences)
- estimated_budget: number — the project budget or contract value in USD (number only, no $)
- timeline_notes: string — key dates, deadlines, or project timeline information
- technology_systems_mentioned: string — any technology platforms, software, or systems mentioned (comma-separated)
- key_pain_points: string — the core problems or challenges the organization is trying to solve
- partnership_type_hint: string — one of: rfp, mou, joint_program, coalition, referral, in_kind, other
- tags: array of strings — 3-6 short topic tags relevant to this opportunity (e.g. "technology-consulting", "renewable-energy")

Return ONLY a valid JSON object. No markdown, no explanation, no code blocks.

PAGE TEXT:
${pageText}`
}

// ── Main handler ──────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── Auth ────────────────────────────────────────────────────
  const jwt = req.headers.authorization?.replace('Bearer ', '')
  if (!jwt) return res.status(401).json({ error: 'Unauthorized' })

  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt)
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' })

  // ── Validate request body ───────────────────────────────────
  const { url } = req.body as { url?: string }
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' })
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(400).json({ error: 'URL must use http or https' })
    }
  } catch {
    return res.status(400).json({ error: 'Invalid URL' })
  }

  // ── Fetch page ──────────────────────────────────────────────
  let html: string
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12000)
    const response = await fetch(parsedUrl.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WrightAdventuresBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })
    clearTimeout(timeout)
    if (!response.ok) {
      return res.status(422).json({ error: `Page returned ${response.status}` })
    }
    html = await response.text()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Fetch failed'
    return res.status(422).json({ error: `Could not fetch URL: ${msg}` })
  }

  const pageText = extractPageText(html)
  const rawExcerpt = pageText.slice(0, 500)
  const logoUrl = extractLogoUrl(html, url)

  // ── Haiku extraction ────────────────────────────────────────
  let extracted: Record<string, unknown> = {}
  let confidence: 'high' | 'medium' | 'low' = 'low'

  try {
    const { text } = await generateText({
      model: anthropic('claude-haiku-4-5-20251001'),
      system: SYSTEM,
      messages: [{ role: 'user', content: buildPrompt(pageText) }],
      maxTokens: 1024,
    })

    try {
      // Strip markdown code fences Haiku sometimes adds despite instructions
      const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '')
      extracted = JSON.parse(cleaned)
    } catch {
      // Haiku returned something unparseable — return empty extraction
      console.error('JSON parse failed. Raw Haiku response:', text)
      extracted = {}
    }

    // Confidence based on how many fields were extracted
    const fieldCount = Object.keys(extracted).length
    confidence = fieldCount >= 6 ? 'high' : fieldCount >= 3 ? 'medium' : 'low'
  } catch (err) {
    // AI call failed — still return empty extraction rather than 500
    console.error('Haiku extraction error:', err)
    extracted = {}
  }

  if (logoUrl) extracted.logo_url = logoUrl

  return res.status(200).json({
    extracted,
    confidence,
    raw_excerpt: rawExcerpt,
  })
}
