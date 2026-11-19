import { useCallback, useRef, useState } from 'react'
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from 'lucide-react'
import { formatCell } from '../../lib/query'
import type { RowResult } from '../../lib/query'

const PAGE_SIZES = [25, 50, 100, 500, 1_000]
const COLUMN_WIDTH = { initial: 180, min: 80, max: 1200 }
const ROW_NUMBER_WIDTH = 60

type ResultsGridProps = {
  result: RowResult
  visible: boolean
  pageSize: number
  onPageSize: (size: number) => void
}

export function ResultsGrid({ result, visible, pageSize, onPageSize }: ResultsGridProps) {
  const [page, setPage] = useState(1)
  const [customWidths, setCustomWidths] = useState<(number | null)[]>(() => result.columns.map(() => null))
  const [availableWidth, setAvailableWidth] = useState(0)
  const measureTable = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    const measure = () => setAvailableWidth(node.clientWidth)
    const observer = new ResizeObserver(measure)
    measure()
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const drag = useRef<{ column: number; pointer: number; startX: number; width: number } | null>(null)

  if (!visible) return null

  const { columns, rows } = result
  const autoColumns = customWidths.filter(width => width === null).length
  const baseWidth = customWidths.reduce<number>((total, width) => total + (width ?? COLUMN_WIDTH.initial), ROW_NUMBER_WIDTH)
  const extraWidth = Math.max(0, availableWidth - baseWidth) / Math.max(1, autoColumns || columns.length)
  const widths = customWidths.map(width => (width ?? COLUMN_WIDTH.initial) + (width === null || !autoColumns ? extraWidth : 0))
  const maxColumnWidth = Math.max(COLUMN_WIDTH.max, availableWidth)
  const lastPage = Math.max(1, Math.ceil(rows.length / pageSize))
  const rowOffset = (page - 1) * pageSize
  const visibleRows = rows.slice(rowOffset, rowOffset + pageSize)

  function resize(column: number, width: number) {
    const next = Math.min(maxColumnWidth, Math.max(COLUMN_WIDTH.min, width))
    setCustomWidths(current => current.map((value, index) => index === column ? next : value))
  }

  return (
    <>
      <div className="results-content" ref={measureTable}>
        <table className="results-table" style={{ width: widths.reduce((sum, width) => sum + width, ROW_NUMBER_WIDTH) }}>
          <caption className="sr-only">Query result rows</caption>
          <colgroup><col style={{ width: ROW_NUMBER_WIDTH }} />{widths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
          <thead><tr>
            <th scope="col" className="row-number">#</th>
            {columns.map(({ name, type }, index) => (
              <th key={index} scope="col">
                <span className="result-column-label" title={`${name} · ${type}`}>{name}</span>
                <span className="column-resize" role="separator" tabIndex={0} aria-label={`Resize ${name}`} aria-orientation="vertical"
                  aria-valuemin={COLUMN_WIDTH.min} aria-valuemax={maxColumnWidth} aria-valuenow={Math.round(widths[index])}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return
                    event.currentTarget.setPointerCapture(event.pointerId)
                    drag.current = { column: index, pointer: event.pointerId, startX: event.clientX, width: widths[index] }
                  }}
                  onPointerMove={(event) => {
                    const active = drag.current
                    if (active?.pointer === event.pointerId) resize(active.column, active.width + event.clientX - active.startX)
                  }}
                  onLostPointerCapture={() => { drag.current = null }}
                  onDoubleClick={() => setCustomWidths(current => current.map((width, column) => column === index ? null : width))}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                    event.preventDefault()
                    resize(index, widths[index] + (event.key === 'ArrowRight' ? 16 : -16))
                  }}
                />
              </th>
            ))}
          </tr></thead>
          <tbody>{visibleRows.map((row, rowIndex) => <tr key={rowOffset + rowIndex}>
            <th scope="row" className="row-number">{(rowOffset + rowIndex + 1).toLocaleString()}</th>
            {row.map((value, index) => {
              const content = formatCell(value)
              return <td key={index} className={value === null ? 'null-value' : undefined} title={content}>{content}</td>
            })}
          </tr>)}</tbody>
        </table>
      </div>
      {rows.length > 0 && <footer className="results-footer">
        <div className="results-pagination-controls">
          <label className="page-size">Results per page
            <select value={pageSize} onChange={(event) => { setPage(1); onPageSize(Number(event.target.value)) }}>
              {PAGE_SIZES.map(size => <option key={size} value={size}>{size.toLocaleString()}</option>)}
            </select>
          </label>
          <span className="pagination-range" aria-live="polite">{(rowOffset + 1).toLocaleString()}–{(rowOffset + visibleRows.length).toLocaleString()} of {rows.length.toLocaleString()}</span>
          <nav className="pagination" aria-label="Results pagination">
            <button type="button" aria-label="First page" title="First page" disabled={page === 1} onClick={() => setPage(1)}><ChevronFirst size={16} aria-hidden="true" /></button>
            <button type="button" aria-label="Previous page" title="Previous page" disabled={page === 1} onClick={() => setPage(page - 1)}><ChevronLeft size={16} aria-hidden="true" /></button>
            <button type="button" aria-label="Next page" disabled={page === lastPage} onClick={() => setPage(page + 1)}>Next <ChevronRight size={16} aria-hidden="true" /></button>
            <button type="button" aria-label="Last page" title="Last page" disabled={page === lastPage} onClick={() => setPage(lastPage)}><ChevronLast size={16} aria-hidden="true" /></button>
          </nav>
        </div>
      </footer>}
    </>
  )
}
