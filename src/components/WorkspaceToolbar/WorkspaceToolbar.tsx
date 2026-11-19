import { Button } from '@clickhouse/click-ui/Button'
import { IconButton } from '@clickhouse/click-ui/IconButton'
import { Switch } from '@clickhouse/click-ui/Switch'
import { Undo2, Redo2 } from 'lucide-react'
import type { Theme } from '../../lib/theme'
import './workspace-toolbar.css'

type WorkspaceToolbarProps = {
  sidebarOpen: boolean
  assistantEnabled: boolean
  theme: Theme
  canUndo: boolean
  canRedo: boolean
  hasSql: boolean
  queryRunning: boolean
  onToggleSidebar: () => void
  onAssistantChange: (enabled: boolean) => void
  onToggleTheme: () => void
  onUndo: () => void
  onRedo: () => void
  onOpenImport: () => void
  onOpenActivity: () => void
  onRun: () => void
}

export function WorkspaceToolbar({
  sidebarOpen,
  assistantEnabled,
  theme,
  canUndo,
  canRedo,
  hasSql,
  queryRunning,
  onToggleSidebar,
  onAssistantChange,
  onToggleTheme,
  onUndo,
  onRedo,
  onOpenImport,
  onOpenActivity,
  onRun,
}: WorkspaceToolbarProps) {
  return (
    <header className="workspace-header">
      <IconButton
        className="toolbar-control" htmlType="button" type="ghost" icon="sidebar-left"
        aria-label={sidebarOpen ? 'Close database sidebar' : 'Open database sidebar'}
        aria-expanded={sidebarOpen} aria-controls="database-sidebar"
        title={sidebarOpen ? 'Close database sidebar' : 'Open database sidebar'} onClick={onToggleSidebar}
      />
      <div className="header-actions">
        <div className="editor-history" role="group" aria-label="SQL edit history">
          <Button
            className="toolbar-control" htmlType="button" type="empty"
            aria-label="Undo SQL edit" title="Undo (⌘Z / Ctrl+Z)"
            disabled={!canUndo} onClick={onUndo}
          >
            <Undo2 size={16} strokeWidth={1.7} aria-hidden="true" />
          </Button>
          <Button
            className="toolbar-control" htmlType="button" type="empty"
            aria-label="Redo SQL edit" title="Redo (⌘⇧Z / Ctrl+Shift+Z)"
            disabled={!canRedo} onClick={onRedo}
          >
            <Redo2 size={16} strokeWidth={1.7} aria-hidden="true" />
          </Button>
        </div>
        <div className="workspace-preferences" role="group" aria-label="Workspace preferences">
          <Switch
            type="button" orientation="horizontal" label="Assistant" aria-label="SQL assistant"
            checked={assistantEnabled} onCheckedChange={onAssistantChange}
            title={assistantEnabled ? 'Turn off assistant' : 'Turn on assistant'}
          />
          <IconButton
            className="toolbar-control" htmlType="button" type="ghost" icon={theme === 'dark' ? 'light-bulb-on' : 'moon'}
            onClick={onToggleTheme} aria-label="Dark mode" aria-pressed={theme === 'dark'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          />
        </div>
        <span className="toolbar-divider" aria-hidden="true" />
        <IconButton
          className="toolbar-control" htmlType="button" type="ghost" icon="upload"
          aria-label="Insert data from a file" title="Insert data from a file" aria-haspopup="dialog" onClick={onOpenImport}
        />
        <IconButton
          className="toolbar-control" htmlType="button" type="ghost" icon="history"
          aria-label="Open activity log" title="Activity log" aria-haspopup="dialog" onClick={onOpenActivity}
        />
        <Button
          className="run-button" htmlType="button" type="primary"
          iconLeft={queryRunning ? undefined : 'play'} label={queryRunning ? 'Running…' : 'Run'}
          loading={queryRunning} disabled={!hasSql}
          onClick={onRun}
        />
      </div>
    </header>
  )
}
