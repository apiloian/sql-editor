import { useMemo, useRef } from 'react'
import { themes } from '@clickhouse/click-ui'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { AriaComponent, DataZoomSliderComponent, GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'
import { chartPoints } from '../lib/chart'
import type { ChartAxes, ChartKind } from '../lib/chart'
import type { QueryRow } from '../lib/query'
import type { Theme } from '../lib/theme'

echarts.use([BarChart, LineChart, PieChart, AriaComponent, DataZoomSliderComponent, GridComponent, TooltipComponent, CanvasRenderer])

const BAR_ZOOM_ID = 'bar-range'
const PIE_BLUR_OPACITY = 0.22

type ResultsChartProps = {
  rows: QueryRow[]
  columns: string[]
  numericColumns: string[]
  kind: ChartKind
  theme: Theme
  axes: ChartAxes
  onAxesChange: (axes: ChartAxes) => void
}

function fieldTitle(field: string) {
  return field.charAt(0).toLocaleUpperCase() + field.slice(1)
}

export default function ResultsChart({ rows, columns, numericColumns, kind, theme, axes, onAxesChange }: ResultsChartProps) {
  const chartRef = useRef<ReactEChartsCore>(null)
  const { xColumn, yColumn } = axes
  const measureTitle = fieldTitle(yColumn)
  const isPie = kind === 'pie'
  const hasSelection = columns.includes(xColumn) && numericColumns.includes(yColumn)
  const points = useMemo(() => hasSelection ? chartPoints(rows, xColumn, yColumn) : [], [hasSelection, rows, xColumn, yColumn])
  const validPoints = points.filter((point): point is { label: string; value: number } => point.value !== null)
  const missingCount = points.length - validPoints.length
  const canZoom = kind === 'bar' && points.length > 1
  const colors = themes[theme].global.color
  const palette = colors.chart.default
  const seriesColors = [palette.blue, palette.orange, palette.green, palette.violet, palette.teal, palette.fuchsia, palette.sunrise, palette.babyblue, palette.red, palette.slate]
  let message = ''
  if (numericColumns.length === 0) message = 'No numeric columns to plot. Return a numeric value in your SQL query.'
  else if (!hasSelection) message = 'Choose a category and a numeric value to create your chart.'
  else if (validPoints.length === 0) message = 'The selected value column has no plottable numbers.'
  else if (isPie && validPoints.some((point) => point.value < 0)) message = 'Pie charts need non-negative values. Choose another column or adjust your SQL query.'
  else if (isPie && !validPoints.some((point) => point.value > 0)) message = 'Pie charts need at least one positive value.'

  const common: EChartsOption = {
    backgroundColor: 'transparent',
    color: seriesColors,
    textStyle: { color: colors.text.default, fontFamily: 'sans-serif' },
    animation: false,
    aria: { enabled: true },
    tooltip: {
      trigger: isPie ? 'item' : 'axis', renderMode: isPie ? 'html' : 'richText', enterable: false,
      backgroundColor: colors.background.muted, borderColor: colors.stroke.intense,
      textStyle: { color: colors.text.default }, confine: true,
    },
  }

  const option: EChartsOption = isPie ? {
    ...common,
    series: [{
      name: measureTitle, type: 'pie', radius: '65%', stillShowZeroSum: false,
      label: { color: colors.text.default, overflow: 'truncate', width: 110 },
      labelLine: { lineStyle: { width: 1.5 } },
      emphasis: { focus: 'self', scale: false, label: { fontWeight: 'bold', opacity: 1 } },
      blur: {
        itemStyle: { opacity: PIE_BLUR_OPACITY },
        label: { opacity: PIE_BLUR_OPACITY },
        labelLine: { lineStyle: { opacity: PIE_BLUR_OPACITY } },
      },
      data: validPoints.map(({ label, value }, index) => {
        const color = seriesColors[index % seriesColors.length]
        return {
          name: label,
          value,
          itemStyle: { color },
          labelLine: { lineStyle: { color } },
          emphasis: { itemStyle: { color }, labelLine: { lineStyle: { color, opacity: 1 } } },
        }
      }),
    }],
  } : {
    ...common,
    grid: { left: 64, right: 24, top: 22, bottom: canZoom ? 68 : 40, containLabel: true },
    dataZoom: canZoom ? [{
      id: BAR_ZOOM_ID, type: 'slider', xAxisIndex: 0, filterMode: 'filter',
      bottom: 8, height: 20, showDataShadow: false,
      borderColor: colors.stroke.default, backgroundColor: colors.background.muted,
      fillerColor: `${palette.blue}33`,
      handleStyle: { color: colors.background.default, borderColor: palette.blue },
      textStyle: { color: colors.text.default },
    }] : undefined,
    xAxis: {
      type: 'category', name: fieldTitle(xColumn), nameLocation: 'middle', nameGap: 29,
      nameTextStyle: { color: colors.text.default, fontWeight: 600 },
      data: points.map((point) => point.label),
      axisLabel: { color: colors.text.muted, hideOverlap: true, width: 100, overflow: 'truncate' },
      axisLine: { lineStyle: { color: colors.stroke.intense } },
      axisTick: { alignWithLabel: true }, boundaryGap: kind === 'bar',
    },
    yAxis: {
      type: 'value', name: measureTitle, nameLocation: 'middle', nameGap: 56,
      nameTruncate: { maxWidth: 140 },
      nameTextStyle: { color: colors.text.default, fontWeight: 600 },
      axisLabel: { color: colors.text.muted, width: 45, overflow: 'truncate' },
      splitLine: { lineStyle: { color: colors.stroke.default } },
    },
    series: kind === 'bar'
      ? [{ name: measureTitle, type: 'bar', barMaxWidth: 48, data: points.map((point) => point.value) }]
      : [{ name: measureTitle, type: 'line', connectNulls: false, showSymbol: points.length <= 80, areaStyle: kind === 'area' ? { opacity: 0.2 } : undefined, data: points.map((point) => point.value) }],
  }

  function resetZoom() {
    chartRef.current?.getEchartsInstance().dispatchAction({
      type: 'dataZoom', dataZoomId: BAR_ZOOM_ID, start: 0, end: 100,
    })
  }

  return (
    <div className="chart-view">
      <div className="chart-controls">
        <label>{isPie ? 'Slice label' : 'Category'}
          <select value={columns.includes(xColumn) ? xColumn : ''} onChange={(event) => onAxesChange({ ...axes, xColumn: event.target.value })}>
            <option value="" disabled>Select a column</option>
            {columns.map((column) => <option key={column} value={column}>{column}</option>)}
          </select>
        </label>
        <label>{isPie ? 'Slice size' : 'Measure'}
          <select value={numericColumns.includes(yColumn) ? yColumn : ''} onChange={(event) => onAxesChange({ ...axes, yColumn: event.target.value })} disabled={numericColumns.length === 0}>
            <option value="" disabled>Select a numeric column</option>
            {numericColumns.map((column) => <option key={column} value={column}>{column}</option>)}
          </select>
        </label>
        {canZoom && !message && <button type="button" className="chart-reset-zoom" onClick={resetZoom}>Reset zoom</button>}
        <span className="chart-note">All result rows · SQL controls order and aggregation</span>
      </div>
      <div className="chart-stage">
        {message ? <div className="empty-state"><h3>Set up your chart</h3><p>{message}</p></div>
          : <ReactEChartsCore key={JSON.stringify([kind, xColumn])} ref={chartRef} echarts={echarts} option={option} autoResize style={{ height: '100%', width: '100%' }} />}
      </div>
      {hasSelection && missingCount > 0 && <p className="chart-data-note" role="status">{missingCount.toLocaleString()} {missingCount === 1 ? 'value is' : 'values are'} missing, nonnumeric, or outside the safe numeric range. {isPie ? 'These rows are omitted.' : 'These appear as gaps.'}</p>}
    </div>
  )
}
