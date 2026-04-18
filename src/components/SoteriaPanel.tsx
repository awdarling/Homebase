'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const COMPANY_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  action?: any
  actionStatus?: 'pending' | 'confirmed' | 'rejected'
}

interface ImageData {
  data: string
  mediaType: string
}

function MicIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill={active ? 'currentColor' : 'none'} />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  )
}

function ImageIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}

function SoteriaIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4l3 3" />
    </svg>
  )
}

export default function SoteriaPanel() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [listening, setListening] = useState(false)
  const [pendingImage, setPendingImage] = useState<ImageData | null>(null)
  const [pendingImageName, setPendingImageName] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const recognitionRef = useRef<any>(null)
  const supabase = createClient()

  useEffect(() => {
    if (open && messages.length === 0) {
      initSoteria()
    }
  }, [open])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function initSoteria() {
    setLoading(true)
    const res = await fetch('/api/soteria', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
        companyId: COMPANY_ID,
      }),
    })
    const data = await res.json()
    const assistantMessage: Message = {
      id: Date.now().toString(),
      role: 'assistant',
      content: data.message,
      action: data.action ?? null,
      actionStatus: data.action ? 'pending' : undefined,
    }
    setMessages([assistantMessage])
    speakText(data.message)
    setLoading(false)
  }

  async function sendMessage(overrideInput?: string) {
    const text = overrideInput ?? input
    if (!text.trim() && !pendingImage) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text || 'I uploaded an image.',
    }

    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    const apiMessages = newMessages.map((m) => ({ role: m.role, content: m.content }))

    const res = await fetch('/api/soteria', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: apiMessages,
        companyId: COMPANY_ID,
        imageData: pendingImage ?? null,
      }),
    })

    const data = await res.json()
    setPendingImage(null)
    setPendingImageName(null)

    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: data.message,
      action: data.action ?? null,
      actionStatus: data.action ? 'pending' : undefined,
    }

    setMessages((prev) => [...prev, assistantMessage])
    speakText(data.message)
    setLoading(false)
  }

  async function handleConfirmAction(messageId: string, action: any) {
    setMessages((prev) => prev.map((m) =>
      m.id === messageId ? { ...m, actionStatus: 'confirmed' } : m
    ))

    const res = await fetch('/api/soteria/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, companyId: COMPANY_ID }),
    })

    const data = await res.json()

    if (data.success) {
      const confirmMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: `Done — ${action.description} has been saved to Homebase.`,
      }
      setMessages((prev) => [...prev, confirmMessage])
      speakText(confirmMessage.content)
    }
  }

  function handleRejectAction(messageId: string) {
    setMessages((prev) => prev.map((m) =>
      m.id === messageId ? { ...m, actionStatus: 'rejected' } : m
    ))
    const rejectMessage: Message = {
      id: Date.now().toString(),
      role: 'assistant',
      content: "No problem — I won't make that change. What would you like to do differently?",
    }
    setMessages((prev) => [...prev, rejectMessage])
    speakText(rejectMessage.content)
  }

  function speakText(text: string) {
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const cleaned = text.replace(/<[^>]*>/g, '').replace(/[*_#`]/g, '')
    const utterance = new SpeechSynthesisUtterance(cleaned)
    utterance.rate = 1.05
    utterance.pitch = 1
    window.speechSynthesis.speak(utterance)
  }

  function handleMic() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) return

    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
      return
    }

    const recognition = new SpeechRecognition()
    recognition.lang = 'en-US'
    recognition.continuous = false
    recognition.interimResults = false
    recognitionRef.current = recognition

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript
      setInput(transcript)
      setListening(false)
    }

    recognition.onend = () => setListening(false)
    recognition.onerror = () => setListening(false)

    recognition.start()
    setListening(true)
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1]
      setPendingImage({ data: base64, mediaType: file.type as any })
      setPendingImageName(file.name)
    }
    reader.readAsDataURL(file)
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          width: 52,
          height: 52,
          borderRadius: '50%',
          background: open ? 'var(--bg-surface-3)' : 'var(--bg-surface-1)',
          border: '1px solid var(--border-default)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 300,
          color: 'var(--text-secondary)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          transition: 'background 0.15s',
        }}
        title="Open Soteria"
      >
        <SoteriaIcon />
      </button>

      {/* Panel */}
      {open && (
        <div style={{
          position: 'fixed',
          bottom: 88,
          right: 24,
          width: 400,
          height: 560,
          background: 'var(--bg-surface-1)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-xl)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 299,
          overflow: 'hidden',
          boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
        }}>

          {/* Header */}
          <div style={{
            padding: '14px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                Soteria
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                Operational setup assistant
              </div>
            </div>
            <button
              onClick={() => window.speechSynthesis?.cancel()}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: 11,
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-body)',
              }}
            >
              Stop voice
            </button>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
            {messages.map((msg) => (
              <div key={msg.id}>
                <div style={{
                  display: 'flex',
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                }}>
                  <div style={{
                    maxWidth: '85%',
                    padding: '10px 14px',
                    borderRadius: msg.role === 'user'
                      ? '16px 16px 4px 16px'
                      : '16px 16px 16px 4px',
                    background: msg.role === 'user'
                      ? 'var(--bg-surface-3)'
                      : 'var(--bg-surface-2)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: 13,
                    color: 'var(--text-secondary)',
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                  }}>
                    {msg.content}
                  </div>
                </div>

                {/* Action confirmation card */}
                {msg.action && msg.actionStatus === 'pending' && (
                  <div style={{
                    margin: '8px 0 0 0',
                    background: 'var(--bg-surface-2)',
                    border: '1px solid var(--border-default)',
                    borderLeft: '3px solid var(--accent)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '12px 14px',
                  }}>
                    <div style={{ fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
                      Proposed Action
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500, marginBottom: 10 }}>
                      {msg.action.description}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => handleConfirmAction(msg.id, msg.action)}
                        style={{
                          padding: '5px 14px',
                          borderRadius: 'var(--radius-md)',
                          border: '1px solid var(--status-ready-border)',
                          background: 'var(--status-ready-bg)',
                          color: 'var(--status-ready-text)',
                          fontSize: 12,
                          fontFamily: 'var(--font-body)',
                          cursor: 'pointer',
                          fontWeight: 500,
                        }}
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => handleRejectAction(msg.id)}
                        style={{
                          padding: '5px 14px',
                          borderRadius: 'var(--radius-md)',
                          border: '1px solid var(--border-default)',
                          background: 'transparent',
                          color: 'var(--text-muted)',
                          fontSize: 12,
                          fontFamily: 'var(--font-body)',
                          cursor: 'pointer',
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                )}

                {msg.action && msg.actionStatus === 'confirmed' && (
                  <div style={{ fontSize: 11, color: 'var(--status-ready-text)', marginTop: 4, paddingLeft: 4 }}>
                    ✓ Confirmed and saved
                  </div>
                )}

                {msg.action && msg.actionStatus === 'rejected' && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, paddingLeft: 4 }}>
                    — Rejected
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div style={{
                display: 'flex',
                justifyContent: 'flex-start',
              }}>
                <div style={{
                  padding: '10px 14px',
                  borderRadius: '16px 16px 16px 4px',
                  background: 'var(--bg-surface-2)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: 13,
                  color: 'var(--text-muted)',
                }}>
                  Soteria is thinking...
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Image preview */}
          {pendingImageName && (
            <div style={{
              padding: '8px 16px',
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 11,
              color: 'var(--text-muted)',
            }}>
              <ImageIcon />
              {pendingImageName}
              <button
                onClick={() => { setPendingImage(null); setPendingImageName(null) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', marginLeft: 'auto' }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Input */}
          <div style={{
            padding: '12px 16px',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            gap: 8,
            alignItems: 'flex-end',
          }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendMessage()
                }
              }}
              placeholder="Ask Soteria anything..."
              rows={1}
              style={{
                flex: 1,
                background: 'var(--bg-surface-2)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                padding: '8px 12px',
                fontSize: 13,
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-body)',
                resize: 'none',
                outline: 'none',
                lineHeight: 1.5,
              }}
            />

            {/* Image upload */}
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-default)',
                background: 'transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)',
                flexShrink: 0,
              }}
              title="Upload image"
            >
              <ImageIcon />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleImageUpload}
            />

            {/* Mic */}
            <button
              onClick={handleMic}
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--radius-md)',
                border: '1px solid',
                borderColor: listening ? 'var(--accent-border)' : 'var(--border-default)',
                background: listening ? 'var(--accent-dim)' : 'transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: listening ? 'var(--accent)' : 'var(--text-muted)',
                flexShrink: 0,
              }}
              title={listening ? 'Stop listening' : 'Start voice input'}
            >
              <MicIcon active={listening} />
            </button>

            {/* Send */}
            <button
              onClick={() => sendMessage()}
              disabled={loading || (!input.trim() && !pendingImage)}
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--accent-border)',
                background: 'var(--accent-dim)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent)',
                flexShrink: 0,
                opacity: loading || (!input.trim() && !pendingImage) ? 0.4 : 1,
              }}
              title="Send"
            >
              <SendIcon />
            </button>
          </div>
        </div>
      )}
    </>
  )
}