import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, Upload, FileText, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

// ── Form schema ───────────────────────────────────────────────

const schema = z.object({
  meeting_date: z.string().min(1, 'Meeting date is required'),
  meeting_start: z.string().optional(),
  meeting_end: z.string().optional(),
  location: z.string().min(1, 'Location is required'),
  transcript_raw: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

// ── Component ─────────────────────────────────────────────────

export function BoardMeetingNew() {
  const navigate = useNavigate()
  const { session, profile } = useAuth()
  const [step, setStep] = useState<1 | 2>(1)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { register, handleSubmit, formState: { errors }, getValues } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { location: 'Virtual (Google Meet)' },
  })

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    setUploadedFile(file)
  }

  async function onSubmit(values: FormValues) {
    if (!session?.access_token || !profile?.id) return

    const hasTranscript = values.transcript_raw?.trim() || uploadedFile
    if (!hasTranscript) {
      setError('Please paste a transcript or upload a file before submitting.')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      let transcriptRaw = values.transcript_raw?.trim() ?? null

      // If a file was uploaded but no transcript was pasted, read the file as text
      if (uploadedFile && !transcriptRaw) {
        transcriptRaw = await uploadedFile.text()
      }

      // Create board_meetings row
      const { data: meeting, error: insertError } = await supabase
        .from('board_meetings')
        .insert({
          meeting_date: values.meeting_date,
          meeting_start: values.meeting_start || null,
          meeting_end: values.meeting_end || null,
          location: values.location,
          transcript_raw: transcriptRaw,
          created_by: profile.id,
          extraction_status: 'pending',
        })
        .select('id')
        .single()

      if (insertError || !meeting) {
        throw new Error(insertError?.message ?? 'Failed to create meeting record')
      }

      // Trigger AI extraction (non-blocking — we redirect and let the detail page poll)
      fetch('/api/board-minutes/extract', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ meetingId: meeting.id }),
      }).catch(() => {
        // Extraction errors surface on the detail page
      })

      navigate(`/admin/board-meetings/${meeting.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
      setIsSubmitting(false)
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/admin/board-meetings" className="p-1.5 text-gray-400 hover:text-navy rounded-lg hover:bg-gray-50 transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-navy">New Board Meeting</h1>
          <p className="text-sm text-gray-400">Upload a transcript to generate minutes</p>
        </div>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-3 mb-8">
        {([1, 2] as const).map(s => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
              step === s ? 'bg-navy text-white' : step > s ? 'bg-river text-white' : 'bg-gray-100 text-gray-400'
            }`}>
              {s}
            </div>
            <span className={`text-sm ${step === s ? 'text-navy font-medium' : 'text-gray-400'}`}>
              {s === 1 ? 'Meeting Info' : 'Transcript'}
            </span>
            {s === 1 && <span className="text-gray-200 ml-1">›</span>}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit(onSubmit)}>
        {/* ── Step 1: Meeting metadata ── */}
        {step === 1 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
            <div>
              <label className="block text-sm font-medium text-navy mb-1.5">
                Meeting Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                {...register('meeting_date')}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 outline-none focus:border-river focus:ring-1 focus:ring-river/20"
              />
              {errors.meeting_date && (
                <p className="text-xs text-red-500 mt-1">{errors.meeting_date.message}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-navy mb-1.5">
                  Start Time <span className="text-gray-400 font-normal">(approx.)</span>
                </label>
                <input
                  type="time"
                  {...register('meeting_start')}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 outline-none focus:border-river focus:ring-1 focus:ring-river/20"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-navy mb-1.5">
                  End Time <span className="text-gray-400 font-normal">(approx.)</span>
                </label>
                <input
                  type="time"
                  {...register('meeting_end')}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 outline-none focus:border-river focus:ring-1 focus:ring-river/20"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-navy mb-1.5">
                Location <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                {...register('location')}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 outline-none focus:border-river focus:ring-1 focus:ring-river/20"
              />
              {errors.location && (
                <p className="text-xs text-red-500 mt-1">{errors.location.message}</p>
              )}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  const { meeting_date, location } = getValues()
                  if (!meeting_date || !location) return
                  setStep(2)
                }}
                className="text-sm font-medium text-white bg-navy hover:bg-navy/90 px-5 py-2.5 rounded-lg transition-colors"
              >
                Next: Add Transcript →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Transcript ── */}
        {step === 2 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
            <div>
              <label className="block text-sm font-medium text-navy mb-1.5">
                Paste transcript text
              </label>
              <textarea
                {...register('transcript_raw')}
                rows={14}
                placeholder="Paste your Google Meet transcript here (.vtt or plain text)…"
                className="w-full text-sm font-mono border border-gray-200 rounded-lg px-3 py-2.5 outline-none focus:border-river focus:ring-1 focus:ring-river/20 resize-y"
              />
            </div>

            <div className="relative">
              <div className="flex items-center gap-2 text-xs text-gray-400 mb-3">
                <div className="flex-1 h-px bg-gray-100" />
                <span>or upload a file</span>
                <div className="flex-1 h-px bg-gray-100" />
              </div>

              <label className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg p-6 cursor-pointer transition-colors ${
                uploadedFile ? 'border-river bg-river/5' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}>
                {uploadedFile ? (
                  <>
                    <FileText size={20} className="text-river" />
                    <span className="text-sm font-medium text-navy">{uploadedFile.name}</span>
                    <span className="text-xs text-gray-400">
                      {(uploadedFile.size / 1024).toFixed(1)} KB
                    </span>
                  </>
                ) : (
                  <>
                    <Upload size={20} className="text-gray-300" />
                    <span className="text-sm text-gray-400">
                      Drop a .vtt or .txt file, or click to browse
                    </span>
                  </>
                )}
                <input
                  type="file"
                  accept=".vtt,.txt,text/plain,text/vtt"
                  onChange={handleFileChange}
                  className="sr-only"
                />
              </label>
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="text-sm text-gray-500 hover:text-navy transition-colors"
              >
                ← Back
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex items-center gap-2 text-sm font-medium text-white bg-navy hover:bg-navy/90 disabled:opacity-50 px-5 py-2.5 rounded-lg transition-colors"
              >
                {isSubmitting && <Loader2 size={15} className="animate-spin" />}
                {isSubmitting ? 'Processing…' : 'Generate Minutes'}
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  )
}
