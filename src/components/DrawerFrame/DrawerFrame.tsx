import { useRef } from 'react'
import type { ReactNode } from 'react'
import { Dialog, IconButton } from '@clickhouse/click-ui'
import './drawer-frame.css'

type DrawerFrameProps = {
  title: string
  closeLabel: string
  onClose: () => void
  className?: string
  children: ReactNode
}

export function DrawerFrame({ title, closeLabel, onClose, className, children }: DrawerFrameProps) {
  const opener = useRef<HTMLElement | null>(null)

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Content
        className={className ? `table-drawer ${className}` : 'table-drawer'}
        title={title}
        onOpenAutoFocus={() => {
          if (document.activeElement instanceof HTMLElement) opener.current = document.activeElement
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          opener.current?.focus()
        }}
      >
        <IconButton className="toolbar-control drawer-close" type="ghost" htmlType="button" icon="cross" onClick={onClose} aria-label={closeLabel} />
        {children}
      </Dialog.Content>
    </Dialog>
  )
}
