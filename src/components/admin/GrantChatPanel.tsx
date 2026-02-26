import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Send, RotateCcw, AlertTriangle, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useGrantChat } from '../../hooks/useGrantChat'
import type { UIMessage } from 'ai'

interface Props {
  opportunityId: string
}

interface StoredConversation {
  id: string
  created_at: string
  total_input_tokens: number
  total_output_tokens: number
}

// ── Helper: extract text from UIMessage parts ─────────────────
function getMessageText(msg: UIMessage): string {
  const textPart = msg.parts.find(p => p.type === 'text') as { type: 'text'; text: string } | undefined
  return textPart?.text ?? ''
}

// ── Message bubble ────────────────────────────────────────────
function MessageBubble({ role, content }: { role: string; content: string }) {
  const isUser = role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? 'bg-river text-white rounded-br-sm'
            : 'bg-gray-50 text-gray-800 border border-gray-200 rounded-bl-sm'
        }`}
      >
        {content}
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────
export function GrantChatPanel({ opportunityId }: Props) {
  const [activeConvId, setActiveConvId] = useState<string | undefined>()
  const [inputText, setInputText]       = useState('')
  const bottomRef                       = useRef<HTMLDivElement>(null)
  const queryClient                     = useQueryClient()

  // Fetch existing conversations for this opportunity
  const { data: conversations = [] } = useQuery<StoredConversation[]>({
    queryKey: ['ai_conversations', opportunityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_conversations')
        .select('id, created_at, total_input_tokens, total_output_tokens')
        .eq('opportunity_id', opportunityId)
        .eq('is_archived', false)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data ?? []
    },
  })

  // Default to most recent conversation once loaded
  useEffect(() => {
    if (conversations.length > 0 && !activeConvId) {
      setActiveConvId(conversations[conversations.length - 1].id)
    }
  }, [conversations, activeConvId])

  const { messages, sendMessage, status, error, setMessages } = useGrantChat(
    opportunityId,
    activeConvId,
  )

  const isLoading = status === 'streaming' || status === 'submitted'

  // After stream completes, refetch conversations to pick up newly-created conversation IDs
  const prevStatus = useRef(status)
  useEffect(() => {
    if (prevStatus.current !== 'ready' && status === 'ready') {
      queryClient.invalidateQueries({ queryKey: ['ai_conversations', opportunityId] })
    }
    prevStatus.current = status
  }, [status, opportunityId, queryClient])

  // When new conversations are loaded and we don't have an active one, select the latest
  useEffect(() => {
    if (conversations.length > 0 && !activeConvId) {
      setActiveConvId(conversations[conversations.length - 1].id)
    }
  }, [conversations, activeConvId])

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!inputText.trim() || isLoading) return
    const text = inputText.trim()
    setInputText('')
    await sendMessage({ text })
  }

  function handleNewSession() {
    setActiveConvId(undefined)
    setMessages([])
  }

  function handleSelectConversation(id: string) {
    setActiveConvId(id)
    setMessages([])
  }

  const activeConv  = conversations.find(c => c.id === activeConvId)
  const totalTokens = activeConv
    ? activeConv.total_input_tokens + activeConv.total_output_tokens
    : 0
  const turnCount   = messages.length

  const isBudgetExceeded = error?.message?.includes('402') || error?.message?.toLowerCase().includes('budget')

  return (
    <div className="flex flex-col h-[500px] sm:h-[600px]">
      {/* Session picker */}
      {conversations.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center mb-4">
          {conversations.map((c, i) => (
            <button
              key={c.id}
              onClick={() => handleSelectConversation(c.id)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                c.id === activeConvId
                  ? 'bg-river text-white border-river'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-river hover:text-river'
              }`}
            >
              Session {i + 1}
            </button>
          ))}
          <button
            onClick={handleNewSession}
            className="text-xs px-3 py-1 rounded-full border border-dashed border-gray-300 text-gray-400 hover:border-river hover:text-river transition-colors"
          >
            + New session
          </button>
        </div>
      )}

      {/* 20-turn soft limit warning */}
      {turnCount >= 20 && (
        <div className="flex items-start gap-2 p-3 mb-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
          <span>
            This session is getting long. Starting a new session keeps costs down and may improve quality.
          </span>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1 mb-4">
        {messages.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full text-center text-gray-400">
            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-3">
              <Send size={20} className="text-gray-300" />
            </div>
            <p className="text-sm font-medium text-gray-500 mb-1">AI Draft Assistant</p>
            <p className="text-xs max-w-xs">
              Start a conversation to draft grant narrative. I've already reviewed this opportunity's details.
            </p>
          </div>
        )}

        {messages.map(m => {
          const text = getMessageText(m)
          if (!text) return null
          return <MessageBubble key={m.id} role={m.role} content={text} />
        })}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-50 border border-gray-200 rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex gap-1 items-center">
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}

        {/* Budget exceeded error */}
        {isBudgetExceeded && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-red-500" />
            <span>Monthly AI budget exceeded. Contact your admin to increase the limit.</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Footer: input + token usage */}
      <div className="border-t border-gray-100 pt-3">
        {totalTokens > 0 && (
          <p className="text-xs text-gray-400 mb-2 text-right">
            {totalTokens.toLocaleString()} tokens used this session
          </p>
        )}
        <form onSubmit={handleSend} className="flex gap-2">
          <input
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            placeholder="Ask Claude to draft, revise, or expand…"
            disabled={isLoading}
            className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-river focus:ring-1 focus:ring-river/20 placeholder-gray-400 disabled:bg-gray-50 disabled:text-gray-400"
          />
          <button
            type="submit"
            disabled={isLoading || !inputText.trim()}
            className="flex items-center gap-1.5 bg-river text-white text-sm px-4 py-2 rounded-lg hover:bg-river/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Send
          </button>
        </form>

        {turnCount >= 20 && (
          <button
            onClick={handleNewSession}
            className="mt-2 flex items-center gap-1.5 text-xs text-gray-400 hover:text-navy transition-colors"
          >
            <RotateCcw size={12} />
            Start new session
          </button>
        )}
      </div>
    </div>
  )
}
