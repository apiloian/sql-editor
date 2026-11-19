import { themes } from '@clickhouse/click-ui'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { AriaComponent, GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'
import { chartNumber, chartPoints } from '../lib/chart'
import type { ChartAxes, ChartKind } from '../lib/chart'
import type { QueryRow } from '../lib/query'
import type { Theme } from '../lib/theme'

echarts.use([BarChart, LineChart, PieChart, AriaComponent, GridComponent, TooltipComponent, CanvasRenderer])

type ResultsChartProps = { rows: QueryRow[]; columns: string[]; kind: ChartKind; theme: Theme; axes: ChartAxes; onAxesChange: (axes: ChartAxes) => void }

export default function ResultsChart({ rows, columns, kind, theme, axes, onAxesChange }: ResultsChartProps) {
  const { xColumn, yColumn } = axes
  const numericColumns = columns.filter((column) => rows.some((row) => chartNumber(row[column]) !== null))
  const hasSelection = columns.includes(xColumn) && numericColumns.includes(yColumn)
  const points = hasSelection ? chartPoints(rows, xColumn, yColumn) : []
  const validPoints = points.filter((point) => point.value !== null)
  const missingCount = points.length - validPoints.length
  const colors = themes[theme].global.color
  const palette = colors.chart.default
  let message = ''
  if (numericColumns.length === 0) message = 'No numeric columns to plot. Return a numeric value in your SQL query.'
  else if (!hasSelection) message = 'Choose a category and a numeric value to create your chart.'
  else if (validPoints.length === 0) message = 'The selected value column has no plottable numbers.'
  else if (kind === 'pie' && validPoints.some((point) => point.value !== null && point.value < 0)) message = 'Pie charts need non-negative values. Choose another column or adjust your SQL query.'
  else if (kind === 'pie' && !validPoints.some((point) => point.value !== null && point.value > 0)) message = 'Pie charts need at least one positive value.'

  const common: EChartsOption = {
    backgroundColor: 'transparent',
    color: [palette.blue, palette.orange, palette.green, palette.violet, palette.teal, palette.fuchsia, palette.sunrise, palette.babyblue],
    textStyle: { color: colors.text.default, fontFamily: 'sans-serif' },
    animation: false,
    aria: { enabled: true },
    tooltip: {
      trigger: kind === 'pie' ? 'item' : 'axis', renderMode: 'richText',
      backgroundColor: colors.background.muted, borderColor: colors.stroke.intense,
      textStyle: { color: colors.text.default }, confine: true,
    },
  }
  const option: EChartsOption = kind === 'pie' ? {
    ...common,
    series: [{
      name: yColumn, type: 'pie', radius: '65%', stillShowZeroSum: false,
      label: { color: colors.text.default, overflow: 'truncate', width: 110 },
      labelLine: { lineStyle: { color: colors.text.muted } },
      data: validPoints.flatMap((point) => point.value === null ? [] : [{ name: point.label, value: point.value }]),
    }],
  } : {
    ...common,
    grid: { left: 24, right: 32, top: 24, bottom: 48, containLabel: true },
    xAxis: {
      type: 'category', name: xColumn, nameLocation: 'middle', nameGap: 32,
      data: points.map((point) => point.label),
      axisLabel: { color: colors.text.muted, hideOverlap: true, width: 100, overflow: 'truncate' },
      axisLine: { lineStyle: { color: colors.stroke.intense } },
      axisTick: { alignWithLabel: true }, boundaryGap: kind === 'bar',
    },
    yAxis: {
      type: 'value', axisLabel: { color: colors.text.muted },
      splitLine: { lineStyle: { color: colors.stroke.default } },
    },
    series: kind === 'bar'
      ? [{ name: yColumn, type: 'bar', barMaxWidth: 48, data: points.map((point) => point.value) }]
      : [{ name: yColumn, type: 'line', connectNulls: false, showSymbol: points.length <= 80, areaStyle: kind === 'area' ? { opacity: 0.2 } : undefined, data: points.map((point) => point.value) }],
  }

  return (
    <div className="chart-view">
      <div className="chart-controls">
        <label>{kind === 'pie' ? 'Category' : 'X-axis'}
          <select value={columns.includes(xColumn) ? xColumn : ''} onChange={(event) => onAxesChange({ ...axes, xColumn: event.target.value })}>
            <option value="" disabled>Select a column</option>
            {columns.map((column) => <option key={column} value={column}>{column}</option>)}
          </select>
        </label>
        <label>{kind === 'pie' ? 'Value' : 'Y-axis'}
          <select value={numericColumns.includes(yColumn) ? yColumn : ''} onChange={(event) => onAxesChange({ ...axes, yColumn: event.target.value })} disabled={numericColumns.length === 0}>
            <option value="" disabled>Select a numeric column</option>
            {numericColumns.map((column) => <option key={column} value={column}>{column}</option>)}
          </select>
        </label>
        <span className="chart-note">All result rows · SQL controls order and aggregation</span>
      </div>
      <div className="chart-stage">
        {message ? <div className="empty-state"><h3>Set up your chart</h3><p>{message}</p></div>
          : <ReactEChartsCore echarts={echarts} option={option} notMerge autoResize style={{ height: '100%', width: '100%' }} />}
      </div>
      {hasSelection && missingCount > 0 && <p className="chart-data-note" role="status">{missingCount.toLocaleString()} {missingCount === 1 ? 'value is' : 'values are'} missing, nonnumeric, or outside the safe numeric range. {kind === 'pie' ? 'These rows are omitted.' : 'These appear as gaps.'}</p>}
    </div>
  )
}
