import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Dropdown, Icon } from '@clickhouse/click-ui'
import type { IconName } from '@clickhouse/click-ui'
import { Transcriber } from './Transcriber'

import type { AssistantAction } from '../lib/assistant'
const actions: { id: AssistantAction; label: string; icon: IconName; placeholder: string }[] = [
  { id: 'generate', label: 'Generate', icon: 'query', placeholder: 'Ask AI…' },
  { id: 'fix', label: 'Fix', icon: 'warning', placeholder: 'Fix this SQL…' },
  { id: 'explain', label: 'Explain', icon: 'book', placeholder: 'Explain this SQL…' },
  { id: 'improve', label: 'Improve', icon: 'speed', placeholder: 'Improve this SQL…' },
]

export function AssistantComposer({ currentSql, onRequest }: { currentSql: string; onRequest: (action: AssistantAction, prompt: string, signal: AbortSignal) => Promise<void> }) {
  const [pending, setPending] = useState(false)
  const requestRef = useRef<AbortController | null>(null)
  useEffect(() => () => requestRef.current?.abort(), [])
  const [action, setAction] = useState<AssistantAction>('generate')
  const [prompt, setPrompt] = useState('')
  const [notice, setNotice] = useState('')
  const [voiceDraft, setVoiceDraft] = useState('')
  const [voiceActive, setVoiceActive] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [composerFocused, setComposerFocused] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const restoreInputFocus = useRef(false)
  const selected = actions.find((item) => item.id === action)
  const text = [prompt, voiceDraft].filter(Boolean).join(' ')

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    const composer = input.closest('.assistant-composer')
    if (!composer) return
    const canvas = document.createElement('canvas').getContext('2d')
    function resize() {
      if (!input || !composer) return
      const style = getComputedStyle(input)
      if (canvas) {
        canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
        const compactWidth = Math.min(composerFocused || menuOpen || voiceActive ? 460 : 380, composer.parentElement?.clientWidth ?? 380)
        const toolsWidth = (composer.querySelector('.assistant-action-menu')?.getBoundingClientRect().width ?? 44) + (composer.querySelector('.assistant-composer-controls')?.getBoundingClientRect().width ?? 72)
        const available = Math.max(32, compactWidth - toolsWidth - 34)
        setExpanded(Boolean(text) && (text.includes('\n') || canvas.measureText(text).width > available))
      }
      input.style.height = '0px'
      input.style.height = `${Math.min(260, window.innerHeight * 0.32, Math.max(32, input.scrollHeight))}px`
      if (voiceActive) input.scrollTop = input.scrollHeight
    }
    resize()
    let previousWidth = composer.getBoundingClientRect().width
    const observer = new ResizeObserver(() => {
      const width = composer.getBoundingClientRect().width
      if (width !== previousWidth) { previousWidth = width; resize() }
    })
    observer.observe(composer)
  return () => observer.disconnect()
  }, [voiceActive, text, menuOpen, composerFocused])

    async function submit() {
    if (!prompt.trim() || voiceActive || requestRef.current) return
    const controller = new AbortController()
    requestRef.current = controller
    setPending(true)
    setNotice('Working on your SQL…')
    try {
      await onRequest(action, prompt.trim(), controller.signal)
      if (!controller.signal.aborted) { setPrompt(''); setNotice(action === 'explain' ? 'Comments added. Undo to restore your SQL.' : 'SQL updated. Review it, then Run.') }
    } catch (error) {
      if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : 'The assistant could not respond.')
    } finally {
      requestRef.current = null
      if (!controller.signal.aborted) setPending(false)
    }
  }


  return (
    <div className="assistant-dock">
      <div className="assistant-composer" data-menu-open={menuOpen} data-voice-active={voiceActive} data-expanded={expanded} onFocusCapture={() => setComposerFocused(true)} onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setComposerFocused(false)
      }} onClick={(event) => {
        if (event.target === event.currentTarget || event.target === event.currentTarget.querySelector('form')) inputRef.current?.focus()
      }}>
        {notice && <span className="sr-only" role="status">{notice}</span>}
        <form className="assistant-input-row" onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}>
          <textarea ref={inputRef} rows={1} aria-label="Ask the SQL assistant" placeholder={selected?.placeholder} value={text} readOnly={voiceActive || pending} onChange={(event) => { setPrompt(event.target.value); setNotice('') }} onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }} />
          <div className="assistant-composer-toolbar">
          <Dropdown modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
            <Dropdown.Trigger className="assistant-action-menu" role="button" tabIndex={0} aria-label={`Assistant action: ${selected?.label}`}><Icon name={selected?.icon ?? 'query'} color="currentColor" size="sm" aria-hidden="true" /><Icon name="chevron-down" size="xs" aria-hidden="true" /></Dropdown.Trigger>
            <Dropdown.Content className="assistant-dropdown" side="top" align="start" onEscapeKeyDown={() => { restoreInputFocus.current = true }} onCloseAutoFocus={(event) => {
              if (restoreInputFocus.current) {
                event.preventDefault()
                restoreInputFocus.current = false
                inputRef.current?.focus({ preventScroll: true })
              }
            }}>
              {actions.map((item) => <Dropdown.Item key={item.id} className="assistant-dropdown-item" icon={item.icon} data-selected={action === item.id} disabled={item.id !== 'generate' && !currentSql.trim()} onSelect={() => { restoreInputFocus.current = true; setAction(item.id); setNotice('') }}><span className="assistant-menu-label"><span>{item.label} SQL</span><span className="assistant-menu-check">{action === item.id && <Icon name="check" size="xs" aria-hidden="true" />}</span></span></Dropdown.Item>)}
            </Dropdown.Content>
          </Dropdown>
          <div className="assistant-composer-controls">
          <Transcriber onTranscriptPartial={setVoiceDraft} onActiveChange={setVoiceActive} onTranscriptComplete={(text) => { setPrompt((current) => current.trim() ? `${current.trimEnd()} ${text}` : text); setNotice('') }} />
          <button className="assistant-send" type="submit" disabled={!prompt.trim() || voiceActive || pending} aria-label="Send to SQL assistant" title="Send to SQL assistant"><Icon name={pending ? "loading" : "arrow-up"} size="sm" aria-hidden="true" /></button>
          </div>
          </div>
        </form>
      </div>
    </div>
  )
}
