import { useEffect, useState } from 'react'
import { CopilotChatConfigurationProvider, CopilotChatInput, CopilotKitProvider } from '@copilotkit/react-core/v2'
import { Square } from 'lucide-react'
import '@copilotkit/react-core/v2/styles.css'
import { apiUrl } from '../../lib/api'
import { ASSISTANT_AGENT_ID, useAssistantTurn } from '../../hooks/useAssistantTurn'
import type { AssistantNotice, AssistantTurnOptions } from '../../hooks/useAssistantTurn'
import { useVoiceTranscript } from '../../hooks/useVoiceTranscript'
import './assistant-composer.css'

const MAX_PROMPT_LENGTH = 4_000

type ComposerProps = AssistantTurnOptions & { enabled: boolean }

function NoAttachments() { return null }

export function AssistantComposer(props: ComposerProps) {
  const runtimeUrl = apiUrl('/assistant')
  if (!runtimeUrl) {
    return <div className="assistant-dock" hidden={!props.enabled}>
      <div className="assistant-composer">
        <CopilotChatInput className="[&_.copilotKitInput>div[data-layout]]:py-1!" showDisclaimer={false} addMenuButton={NoAttachments} textArea={{ 'aria-label': 'Ask the SQL assistant', disabled: true, placeholder: 'Assistant unavailable' }} />
      </div>
    </div>
  }
  return <CopilotKitProvider runtimeUrl={runtimeUrl} agentId={ASSISTANT_AGENT_ID} useSingleEndpoint={false} enableInspector={false} showDevConsole={false}>
    <AssistantConversation {...props} />
  </CopilotKitProvider>
}

function AssistantConversation({ enabled, ...turnOptions }: ComposerProps) {
  const { isReady, pending, run, stop } = useAssistantTurn(turnOptions)
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState<AssistantNotice | null>(null)
  const voice = useVoiceTranscript((transcript) => {
    setDraft((text) => [text.trimEnd(), transcript].filter(Boolean).join(' ').slice(0, MAX_PROMPT_LENGTH))
  })
  const { cancel: cancelVoice } = voice
  useEffect(() => { if (!enabled) cancelVoice() }, [enabled, cancelVoice])

  const listening = voice.state.status === 'listening'
  const voiceBusy = voice.state.status !== 'idle' && voice.state.status !== 'error'
  const voiceText = voice.state.status === 'loading' ? 'Loading local voice model…'
    : voice.state.status === 'requesting' ? 'Waiting for microphone permission…'
      : voice.state.status === 'transcribing' ? 'Transcribing locally…'
        : voice.state.status === 'error' ? voice.state.message : ''
  const micLabel = listening ? 'Stop recording' : 'Start voice input'
  const prompt = [draft.trimEnd(), voice.partial].filter(Boolean).join(' ')

  async function submit(text: string) {
    if (voiceBusy) return
    const outcome = await run(text)
    if (!outcome) return
    if (outcome.kind !== 'reply') setDraft(text)
    setNotice(outcome)
  }

  const message = voiceText
    ? { kind: voice.state.status === 'error' ? 'error' : 'status', text: voiceText }
    : pending ? { kind: 'status', text: 'Working on your SQL…' } : notice

  return <div className="assistant-dock" hidden={!enabled}>
    <div className="assistant-composer" data-voice-active={voiceBusy}>
      {message && <div className="assistant-notice" role={message.kind === 'error' ? 'alert' : 'status'}>
        <span>{message.text}</span>
        {notice === message && <button type="button" aria-label="Dismiss assistant message"
          onPointerDown={(event) => {
            // Keep the composer layout stable until the pointer click completes.
            if (event.button === 0) event.preventDefault()
          }}
          onClick={() => setNotice(null)}>×</button>}
      </div>}
      <CopilotChatConfigurationProvider labels={{
        chatInputPlaceholder: 'Ask AI…',
        chatInputToolbarStartTranscribeButtonLabel: micLabel,
      }}>
        <CopilotChatInput
          className="[&_.copilotKitInput>div[data-layout]]:py-1!"
          value={voiceBusy ? prompt : draft}
          onChange={(text) => { setDraft(text); setNotice(null) }}
          isRunning={pending}
          onSubmitMessage={isReady && !pending && !voiceBusy ? (text) => { void submit(text) } : undefined}
          onStop={stop}
          onStartTranscribe={() => { if (listening) void voice.stop(); else void voice.start() }}
          showDisclaimer={false}
          addMenuButton={NoAttachments}
          textArea={{ 'aria-label': 'Ask the SQL assistant', readOnly: voiceBusy || pending, maxLength: MAX_PROMPT_LENGTH }}
          startTranscribeButton={{
            'aria-label': micLabel,
            'aria-pressed': listening,
            disabled: !voice.supported || pending || (voiceBusy && !listening),
            ...(listening && { icon: <Square size={14} fill="currentColor" aria-hidden="true" /> }),
          }}
          sendButton={{
            'aria-label': pending ? 'Cancel assistant request' : 'Send to SQL assistant',
            style: { width: 32, height: 32, padding: 6 },
          }}
        />
      </CopilotChatConfigurationProvider>
    </div>
  </div>
}
