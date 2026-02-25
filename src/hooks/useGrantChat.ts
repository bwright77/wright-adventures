import { useRef } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useAuth } from '../contexts/AuthContext'

export function useGrantChat(
  opportunityId: string,
  convId: string | undefined,
) {
  const { session } = useAuth()
  // Use a ref so the transport closure always reads the latest values
  const convIdRef      = useRef(convId)
  const sessionRef     = useRef(session)
  convIdRef.current    = convId
  sessionRef.current   = session

  return useChat({
    transport: new DefaultChatTransport({
      api: '/api/ai/chat',
      prepareSendMessagesRequest: async ({ messages }) => {
        // Extract last user message text — the server manages full history via Supabase
        const lastMsg   = messages[messages.length - 1]
        const textPart  = lastMsg?.parts?.find((p: { type: string }) => p.type === 'text') as { type: 'text'; text: string } | undefined
        const messageText = textPart?.text ?? ''

        return {
          headers: {
            Authorization: `Bearer ${sessionRef.current?.access_token ?? ''}`,
          },
          body: {
            message:         messageText,
            conversation_id: convIdRef.current,
            opportunity_id:  convIdRef.current ? undefined : opportunityId,
          },
        }
      },
    }),
    onError: (error) => {
      console.error('AI chat error:', error)
    },
  })
}
