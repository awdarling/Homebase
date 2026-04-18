'use client'

import { useEffect, useRef, useState } from 'react'

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

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  )
}

export default function SoteriaPanel() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [pendingImage, setPendingImage] = useState<ImageData | null>(null)
  const [pendingImageName, setPendingImageName] = useState<string | null>(null)
  const [showTooltip, setShowTooltip] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const recognitionRef = useRef<any>(null)

  useEffect(() => {
    if (open && messages.length === 0) {
      initSoteria()
    }
  }, [open])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Show tooltip after 2 seconds if panel is closed
  useEffect(() => {
    if (!open) {
      const timer = setTimeout(() => setShowTooltip(true), 2000)
      return () => clearTimeout(timer)
    } else {
      setShowTooltip(false)
    }
  }, [open])

  async function initSoteria() {
    setLoading(true)
    try {
      const res = await fetch('/api/soteria', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }],
          companyId: COMPANY_ID,
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      const assistantMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: data.message,
        action: data.action ?? null,
        actionStatus: data.action ? 'pending' : undefined,
      }
      setMessages([assistantMessage])
      speakText(data.message)
    } catch (e) {
      setMessages([{
        id: Date.now().toString(),
        role: 'assistant',
        content: "Hi, I'm Soteria. I'm having trouble connecting right now — please try again in a moment.",
      }])
    }
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

    try {
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
      if (data.error) throw new Error(data.error)
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
    } catch (e) {
      setMessages((prev) => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: "Something went wrong. Please try again.",
      }])
    }
    setLoading(false)
  }

  async function handleConfirmAction(messageId: string, action: any) {
    setMessages((prev) => prev.map((m) =>
      m.id === messageId ? { ...m, actionStatus: 'confirmed' } : m
    ))
    try {
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
    } catch (e) {
      console.error('Execute error:', e)
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
    
    const voices = window.speechSynthesis.getVoices()
    const preferred = ['Samantha', 'Karen', 'Moira', 'Fiona', 'Victoria']
    const picked = preferred.reduce<SpeechSynthesisVoice | null>((found, name) => {
      if (found) return found
      return voices.find(v => v.name === name) ?? null
    }, null)
    
    if (picked) utterance.voice = picked
    utterance.rate = 0.95
    utterance.pitch = 1.05
    utterance.onstart = () => setSpeaking(true)
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    window.speechSynthesis.speak(utterance)
  }

  function handleStopVoice() {
    window.speechSynthesis?.cancel()
    setSpeaking(false)
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
      {/* Tooltip */}
      {showTooltip && !open && (
        <div style={{
          position: 'fixed',
          bottom: 88,
          right: 24,
          background: 'var(--bg-surface-1)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          padding: '10px 14px',
          fontSize: 12,
          color: 'var(--text-secondary)',
          maxWidth: 220,
          zIndex: 299,
          lineHeight: 1.5,
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        }}>
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>
            Talk to Soteria
          </div>
          Your operational setup and feedback assistant. Ask questions, get advice, or set up your team.
          <button
            onClick={() => setShowTooltip(false)}
            style={{
              position: 'absolute',
              top: 6,
              right: 8,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              color: 'var(--text-muted)',
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Floating button */}
      <button
        onClick={() => { setOpen((o) => !o); setShowTooltip(false) }}
        onMouseEnter={() => !open && setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: 'var(--bg-base)',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 300,
          padding: 0,
          boxShadow: open
            ? '0 0 0 2px var(--accent), 0 0 20px rgba(249,115,22,0.4), 0 4px 20px rgba(0,0,0,0.5)'
            : '0 0 0 1px var(--border-default), 0 4px 20px rgba(0,0,0,0.4)',
          transition: 'box-shadow 0.2s',
        }}
        title="Talk to Soteria"
      >
        <img
          src="/soteria-icon.png"
          alt="Soteria"
          style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover' }}
        />
      </button>

      {/* Panel */}
      {open && (
        <div style={{
          position: 'fixed',
          bottom: 92,
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
          boxShadow: '0 0 0 1px rgba(249,115,22,0.3), 0 0 30px rgba(249,115,22,0.15), 0 8px 40px rgba(0,0,0,0.6)',
        }}>

          {/* Header */}
          <div style={{
            padding: '14px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface-2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <img
                src="/soteria-icon.png"
                alt="Soteria"
                style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }}
              />
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                  Soteria
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                  {speaking ? (
                    <span style={{ color: 'var(--accent)' }}>● Speaking...</span>
                  ) : loading ? (
                    'Thinking...'
                  ) : (
                    'Operational assistant'
                  )}
                </div>
              </div>
            </div>

<div style={{ display: 'flex', gap: 6 }}>
              {speaking && (
                <button
                  onClick={handleStopVoice}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    background: 'var(--accent-dim)',
                    border: '1px solid var(--accent-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '4px 10px',
                    cursor: 'pointer',
                    fontSize: 11,
                    color: 'var(--accent)',
                    fontFamily: 'var(--font-body)',
                  }}
                >
                  <StopIcon /> Stop
                </button>
              )}
              {!speaking && messages.length > 0 && (
                <button
                  onClick={() => {
                    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
                    if (lastAssistant) speakText(lastAssistant.content)
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    background: 'transparent',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-md)',
                    padding: '4px 10px',
                    cursor: 'pointer',
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-body)',
                  }}
                >
                  ▶ Replay
                </button>
              )}
            </div>
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
                  alignItems: 'flex-end',
                  gap: 8,
                }}>
                  {msg.role === 'assistant' && (
                    <img
                      src="/soteria-icon.png"
                      alt="Soteria"
                      style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, marginBottom: 2 }}
                    />
                  )}
                  <div style={{
                    maxWidth: '82%',
                    padding: '10px 14px',
                    borderRadius: msg.role === 'user'
                      ? '16px 16px 4px 16px'
                      : '16px 16px 16px 4px',
                    background: msg.role === 'user'
                      ? 'var(--bg-surface-3)'
                      : 'var(--bg-surface-2)',
                    border: msg.role === 'assistant'
                      ? '1px solid rgba(249,115,22,0.15)'
                      : '1px solid var(--border-subtle)',
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
                    margin: '8px 0 0 28px',
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
                  <div style={{ fontSize: 11, color: 'var(--status-ready-text)', marginTop: 4, paddingLeft: 28 }}>
                    ✓ Confirmed and saved
                  </div>
                )}

                {msg.action && msg.actionStatus === 'rejected' && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, paddingLeft: 28 }}>
                    — Rejected
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                <img
                  src="/soteria-icon.png"
                  alt="Soteria"
                  style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                />
                <div style={{
                  padding: '10px 14px',
                  borderRadius: '16px 16px 16px 4px',
                  background: 'var(--bg-surface-2)',
                  border: '1px solid rgba(249,115,22,0.15)',
                  fontSize: 13,
                  color: 'var(--text-muted)',
                }}>
                  Thinking...
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
              background: 'var(--bg-surface-2)',
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
            background: 'var(--bg-surface-2)',
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
                background: 'var(--bg-surface-3)',
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