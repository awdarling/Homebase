'use client'

import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { useCompany } from '@/lib/hooks/useCompany'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  action?: any
  actionStatus?: 'pending' | 'confirmed' | 'failed' | 'rejected'
  actionError?: string
}

interface ImageData {
  data: string
  mediaType: string
}

interface FileAttachment {
  name: string
  type: 'image' | 'pdf' | 'spreadsheet' | 'document' | 'csv'
  imageData?: ImageData
  textContent?: string
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

function AttachIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
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

function FileTypeIcon({ type }: { type: FileAttachment['type'] }) {
  const color = type === 'image' ? '#10b981'
    : type === 'pdf' ? '#ef4444'
    : type === 'spreadsheet' || type === 'csv' ? '#22c55e'
    : '#3b82f6'
  const label = type === 'image' ? 'IMG'
    : type === 'pdf' ? 'PDF'
    : type === 'spreadsheet' ? 'XLS'
    : type === 'csv' ? 'CSV'
    : 'DOC'
  return (
    <div style={{
      width: 28, height: 28, borderRadius: 4,
      background: color + '22', border: `1px solid ${color}44`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 8, fontWeight: 700, color, flexShrink: 0,
    }}>
      {label}
    </div>
  )
}

function getFileType(file: File): FileAttachment['type'] {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type === 'application/pdf') return 'pdf'
  if (file.type === 'text/csv') return 'csv'
  if (file.type.includes('spreadsheet') || file.type.includes('excel') || file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) return 'spreadsheet'
  return 'document'
}

async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsText(file)
  })
}

async function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function SoteriaPanel() {
  const { company } = useCompany()
  const COMPANY_ID = company?.id ?? ''
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [listening, setListening] = useState(false)
  const [pendingAttachment, setPendingAttachment] = useState<FileAttachment | null>(null)
  const [showTooltip, setShowTooltip] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const recognitionRef = useRef<any>(null)

  useEffect(() => {
    if (open && messages.length === 0) initSoteria()
  }, [open])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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
    } catch {
      setMessages([{
        id: Date.now().toString(),
        role: 'assistant',
        content: "Hi, I'm Soteria. I'm having trouble connecting right now — please try again in a moment.",
      }])
    }
    setLoading(false)
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    const fileType = getFileType(file)

    if (fileType === 'image') {
      const base64 = await readFileAsBase64(file)
      setPendingAttachment({
        name: file.name,
        type: 'image',
        imageData: { data: base64, mediaType: file.type },
      })
    } else if (fileType === 'csv') {
      const text = await readFileAsText(file)
      setPendingAttachment({
        name: file.name,
        type: 'csv',
        textContent: text,
      })
    } else if (fileType === 'pdf') {
      const base64 = await readFileAsBase64(file)
      setPendingAttachment({
        name: file.name,
        type: 'pdf',
        imageData: { data: base64, mediaType: 'application/pdf' },
      })
    } else {
      // Excel and Word — read as base64, Soteria API handles parsing
      const base64 = await readFileAsBase64(file)
      setPendingAttachment({
        name: file.name,
        type: fileType,
        imageData: { data: base64, mediaType: file.type },
      })
    }
  }

  async function sendMessage(overrideInput?: string) {
    const text = overrideInput ?? input
    if (!text.trim() && !pendingAttachment) return

    const userContent = text || `I uploaded a file: ${pendingAttachment?.name}`
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: userContent,
    }

    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      const apiMessages = newMessages.map((m) => ({ role: m.role, content: m.content }))

      // Build context string for non-image files
      let enhancedMessages = apiMessages
      if (pendingAttachment?.textContent) {
        enhancedMessages = apiMessages.map((m, i) =>
          i === apiMessages.length - 1
            ? { ...m, content: `${m.content}\n\nFile contents (${pendingAttachment.name}):\n${pendingAttachment.textContent}` }
            : m
        )
      }

      const res = await fetch('/api/soteria', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: enhancedMessages,
          companyId: COMPANY_ID,
          imageData: pendingAttachment?.imageData ?? null,
          fileName: pendingAttachment?.name ?? null,
          fileType: pendingAttachment?.type ?? null,
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setPendingAttachment(null)

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.message,
        action: data.action ?? null,
        actionStatus: data.action ? 'pending' : undefined,
      }
      setMessages((prev) => [...prev, assistantMessage])
    } catch {
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

      let data: { success?: boolean; error?: string } = {}
      try {
        data = await res.json()
      } catch {
        // body wasn't JSON
      }

      if (!res.ok || !data.success || data.error) {
        const errMsg = data.error ?? `Request failed (${res.status})`
        console.error('Soteria execute error:', errMsg)
        setMessages((prev) => prev.map((m) =>
          m.id === messageId ? { ...m, actionStatus: 'failed', actionError: errMsg } : m
        ))
        return
      }

      const followUpContent = action.type === 'trigger_schedule_build'
        ? "Got it — I've triggered the schedule build. You'll receive a text when it's ready."
        : `Done — ${action.description} has been saved to Homebase.`

      const confirmMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: followUpContent,
      }
      setMessages((prev) => [...prev, confirmMessage])
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'Network error'
      console.error('Execute error:', e)
      setMessages((prev) => prev.map((m) =>
        m.id === messageId ? { ...m, actionStatus: 'failed', actionError: errMsg } : m
      ))
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

  return (
    <>
      {showTooltip && !open && (
        <div style={{
          position: 'fixed', bottom: 88, right: 24,
          background: 'var(--bg-surface-1)', border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)', padding: '10px 14px',
          fontSize: 12, color: 'var(--text-secondary)', maxWidth: 220,
          zIndex: 299, lineHeight: 1.5, boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        }}>
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>
            Talk to Soteria
          </div>
          Your operational setup and feedback assistant. Ask questions, get advice, or upload files to set up your team.
          <button onClick={() => setShowTooltip(false)} style={{
            position: 'absolute', top: 6, right: 8, background: 'none',
            border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)',
          }}>✕</button>
        </div>
      )}

      <button
        onClick={() => { setOpen((o) => !o); setShowTooltip(false) }}
        onMouseEnter={() => !open && setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        style={{
          position: 'fixed', bottom: 24, right: 24, width: 56, height: 56,
          borderRadius: '50%', background: 'var(--bg-base)', border: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', zIndex: 300, padding: 0,
          boxShadow: open
            ? '0 0 0 2px var(--accent), 0 0 20px rgba(249,115,22,0.4), 0 4px 20px rgba(0,0,0,0.5)'
            : '0 0 0 1px var(--border-default), 0 4px 20px rgba(0,0,0,0.4)',
          transition: 'box-shadow 0.2s',
        }}
        title="Talk to Soteria"
      >
        <img src="/soteria-icon.png" alt="Soteria" style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover' }} />
      </button>

      {open && (
        <div style={{
          position: 'fixed', bottom: 92, right: 24, width: 400, height: 560,
          background: 'var(--bg-surface-1)', border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-xl)', display: 'flex', flexDirection: 'column',
          zIndex: 299, overflow: 'hidden',
          boxShadow: '0 0 0 1px rgba(249,115,22,0.3), 0 0 30px rgba(249,115,22,0.15), 0 8px 40px rgba(0,0,0,0.6)',
        }}>

          {/* Header */}
          <div style={{
            padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface-2)', display: 'flex',
            alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <img src="/soteria-icon.png" alt="Soteria" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                  Soteria
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                  {loading ? 'Thinking...' : 'Operational assistant'}
                </div>
              </div>
            </div>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1, overflowY: 'auto', padding: '16px',
            display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            {messages.map((msg) => (
              <div key={msg.id}>
                <div style={{
                  display: 'flex',
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  alignItems: 'flex-end', gap: 8,
                }}>
                  {msg.role === 'assistant' && (
                    <img src="/soteria-icon.png" alt="Soteria" style={{
                      width: 20, height: 20, borderRadius: '50%',
                      objectFit: 'cover', flexShrink: 0, marginBottom: 2,
                    }} />
                  )}
                  <div style={{
                    maxWidth: '82%', padding: '10px 14px',
                    borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    background: msg.role === 'user' ? 'var(--bg-surface-3)' : 'var(--bg-surface-2)',
                    border: msg.role === 'assistant' ? '1px solid rgba(249,115,22,0.15)' : '1px solid var(--border-subtle)',
                    fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6,
                    whiteSpace: msg.role === 'user' ? 'pre-wrap' : 'normal',
                  }}>
                    {msg.role === 'assistant' ? (
                      <ReactMarkdown
                        components={{
                          p: ({ children }) => (
                            <p style={{
                              margin: '0 0 8px 0',
                              lineHeight: 1.6,
                              fontSize: 13,
                              color: 'var(--text-primary)',
                            }}>
                              {children}
                            </p>
                          ),
                          strong: ({ children }) => (
                            <strong style={{
                              color: 'var(--text-primary)',
                              fontWeight: 600,
                            }}>
                              {children}
                            </strong>
                          ),
                          ul: ({ children }) => (
                            <ul style={{
                              margin: '6px 0',
                              paddingLeft: 18,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 4,
                            }}>
                              {children}
                            </ul>
                          ),
                          ol: ({ children }) => (
                            <ol style={{
                              margin: '6px 0',
                              paddingLeft: 18,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 4,
                            }}>
                              {children}
                            </ol>
                          ),
                          li: ({ children }) => (
                            <li style={{
                              fontSize: 13,
                              lineHeight: 1.55,
                              color: 'var(--text-primary)',
                            }}>
                              {children}
                            </li>
                          ),
                          h1: ({ children }) => (
                            <h1 style={{
                              fontSize: 15,
                              fontWeight: 700,
                              margin: '10px 0 6px',
                              color: 'var(--text-primary)',
                            }}>
                              {children}
                            </h1>
                          ),
                          h2: ({ children }) => (
                            <h2 style={{
                              fontSize: 14,
                              fontWeight: 700,
                              margin: '10px 0 4px',
                              color: 'var(--text-primary)',
                            }}>
                              {children}
                            </h2>
                          ),
                          h3: ({ children }) => (
                            <h3 style={{
                              fontSize: 13,
                              fontWeight: 600,
                              margin: '8px 0 4px',
                              color: 'var(--accent)',
                            }}>
                              {children}
                            </h3>
                          ),
                          code: ({ children }) => (
                            <code style={{
                              background: 'var(--bg-surface-3)',
                              border: '1px solid var(--border-default)',
                              borderRadius: 4,
                              padding: '1px 5px',
                              fontSize: 11,
                              fontFamily: 'monospace',
                              color: 'var(--accent)',
                            }}>
                              {children}
                            </code>
                          ),
                          hr: () => (
                            <hr style={{
                              border: 'none',
                              borderTop: '1px solid var(--border-subtle)',
                              margin: '8px 0',
                            }} />
                          ),
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    ) : (
                      msg.content
                    )}
                  </div>
                </div>

                {msg.action && msg.actionStatus === 'pending' && (
                  <div style={{
                    margin: '8px 0 0 28px', background: 'var(--bg-surface-2)',
                    border: '1px solid var(--border-default)', borderLeft: '3px solid var(--accent)',
                    borderRadius: 'var(--radius-lg)', padding: '12px 14px',
                  }}>
                    <div style={{ fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>
                      Proposed Action
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500, marginBottom: 10 }}>
                      {msg.action.description}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => handleConfirmAction(msg.id, msg.action)} style={{
                        padding: '5px 14px', borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--status-ready-border)',
                        background: 'var(--status-ready-bg)', color: 'var(--status-ready-text)',
                        fontSize: 12, fontFamily: 'var(--font-body)', cursor: 'pointer', fontWeight: 500,
                      }}>Confirm</button>
                      <button onClick={() => handleRejectAction(msg.id)} style={{
                        padding: '5px 14px', borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-default)', background: 'transparent',
                        color: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-body)', cursor: 'pointer',
                      }}>Reject</button>
                    </div>
                  </div>
                )}
                {msg.action && msg.actionStatus === 'confirmed' && (
                  <div style={{ fontSize: 11, color: 'var(--status-ready-text)', marginTop: 4, paddingLeft: 28 }}>
                    {msg.action.type === 'trigger_schedule_build'
                      ? "✓ Schedule build triggered — you'll receive a text when it's ready"
                      : '✓ Confirmed and saved'}
                  </div>
                )}
                {msg.action && msg.actionStatus === 'failed' && (
                  <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4, paddingLeft: 28 }}>
                    ✗ Failed — {msg.actionError ?? 'Unknown error'}
                  </div>
                )}
                {msg.action && msg.actionStatus === 'rejected' && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, paddingLeft: 28 }}>— Rejected</div>
                )}
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                <img src="/soteria-icon.png" alt="Soteria" style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                <div style={{
                  padding: '10px 14px', borderRadius: '16px 16px 16px 4px',
                  background: 'var(--bg-surface-2)', border: '1px solid rgba(249,115,22,0.15)',
                  fontSize: 13, color: 'var(--text-muted)',
                }}>Thinking...</div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Attachment preview */}
          {pendingAttachment && (
            <div style={{
              padding: '8px 16px', borderTop: '1px solid var(--border-subtle)',
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'var(--bg-surface-2)',
            }}>
              <FileTypeIcon type={pendingAttachment.type} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {pendingAttachment.name}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                  {pendingAttachment.type === 'csv' ? 'CSV — Soteria will read the data'
                    : pendingAttachment.type === 'pdf' ? 'PDF — Soteria will read the content'
                    : pendingAttachment.type === 'spreadsheet' ? 'Spreadsheet — Soteria will read the data'
                    : pendingAttachment.type === 'document' ? 'Document — Soteria will read the content'
                    : 'Image — Soteria will analyse it'}
                </div>
              </div>
              <button onClick={() => setPendingAttachment(null)} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)', fontSize: 14, flexShrink: 0,
              }}>✕</button>
            </div>
          )}

          {/* Input */}
          <div style={{
            padding: '12px 16px', borderTop: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface-2)', display: 'flex', gap: 8, alignItems: 'flex-end',
          }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
              }}
              placeholder="Ask Soteria anything..."
              rows={1}
              style={{
                flex: 1, background: 'var(--bg-surface-3)',
                border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
                padding: '8px 12px', fontSize: 13, color: 'var(--text-primary)',
                fontFamily: 'var(--font-body)', resize: 'none', outline: 'none', lineHeight: 1.5,
              }}
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                width: 36, height: 36, borderRadius: 'var(--radius-md)',
                border: `1px solid ${pendingAttachment ? 'var(--accent-border)' : 'var(--border-default)'}`,
                background: pendingAttachment ? 'var(--accent-dim)' : 'transparent',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: pendingAttachment ? 'var(--accent)' : 'var(--text-muted)', flexShrink: 0,
              }}
              title="Attach file — images, PDFs, Excel, CSV, Word"
            >
              <AttachIcon />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf,.csv,.xlsx,.xls,.doc,.docx"
              style={{ display: 'none' }}
              onChange={handleFileUpload}
            />

            <button
              onClick={handleMic}
              style={{
                width: 36, height: 36, borderRadius: 'var(--radius-md)',
                border: `1px solid ${listening ? 'var(--accent-border)' : 'var(--border-default)'}`,
                background: listening ? 'var(--accent-dim)' : 'transparent',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: listening ? 'var(--accent)' : 'var(--text-muted)', flexShrink: 0,
              }}
              title={listening ? 'Stop listening' : 'Start voice input'}
            >
              <MicIcon active={listening} />
            </button>

            <button
              onClick={() => sendMessage()}
              disabled={loading || (!input.trim() && !pendingAttachment)}
              style={{
                width: 36, height: 36, borderRadius: 'var(--radius-md)',
                border: '1px solid var(--accent-border)', background: 'var(--accent-dim)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--accent)', flexShrink: 0,
                opacity: loading || (!input.trim() && !pendingAttachment) ? 0.4 : 1,
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