import { useMemo, useRef, useState } from 'react'
import { themes } from '@clickhouse/click-ui'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { AriaComponent, BrushComponent, DataZoomInsideComponent, GridComponent, LegendScrollComponent, ToolboxComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'
import type { EChartsType } from 'echarts/core'
import { chartFields, fieldTitle, prepareChart } from '../../lib/chart'
import type { ChartAxes, ChartKind } from '../../lib/chart'
import type { RowResult } from '../../lib/query'
import type { Theme } from '../../lib/theme'
import './results-chart.css'

echarts.use([BarChart, LineChart, PieChart, AriaComponent, BrushComponent, DataZoomInsideComponent, GridComponent, LegendScrollComponent, ToolboxComponent, TooltipComponent, CanvasRenderer])

const CATEGORY_ZOOM_ID = 'category-range'
const PIE_BLUR_OPACITY = 0.22

function zoomToBrush({ areas }: { areas: { coordRange?: unknown }[] }, chart: EChartsType) {
  chart.dispatchAction({ type: 'brush', areas: [] })
  const range = areas[0]?.coordRange
  if (!Array.isArray(range) || range.length !== 2) return
  const [startValue, endValue] = range
  if (!Number.isInteger(startValue) || !Number.isInteger(endValue)) return
  chart.dispatchAction({ type: 'dataZoom', dataZoomId: CATEGORY_ZOOM_ID, startValue, endValue })
}

type ResultsChartProps = {
  result: RowResult
  kind: ChartKind
  theme: Theme
  axes: ChartAxes
  onAxesChange: (axes: ChartAxes) => void
}

export default function ResultsChart({ result, kind, theme, axes, onAxesChange }: ResultsChartProps) {
  const chartRef = useRef<ReactEChartsCore>(null)
  const [zoomedChartKey, setZoomedChartKey] = useState<string | null>(null)
  const fields = useMemo(() => chartFields(result), [result])
  const chart = useMemo(() => prepareChart(result.rows, fields, axes, kind), [result.rows, fields, axes, kind])
  const { category, measure, splitField, splitFields, numericFields, measureTitle, message, validPoints, missingCount, isSplit, categories, measures } = chart
  const isPie = kind === 'pie'
  const chartKey = JSON.stringify([kind, category?.index, splitField?.index])
  const canZoom = !isPie && categories.length > 1
  const colors = themes[theme].global.color
  const palette = colors.chart.default
  const seriesColors = [palette.blue, palette.orange, palette.green, palette.violet, palette.teal, palette.fuchsia, palette.sunrise, palette.babyblue, palette.red, palette.slate]

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
    grid: { left: 64, right: 24, top: isSplit ? 54 : 22, bottom: 40, containLabel: true },
    legend: isSplit ? {
      type: 'scroll', top: 8, left: 24, right: 24,
      textStyle: { color: colors.text.default, width: 140, overflow: 'truncate' },
      pageTextStyle: { color: colors.text.default },
      pageIconColor: colors.text.default, pageIconInactiveColor: colors.text.muted,
    } : undefined,
    toolbox: canZoom ? { show: false } : undefined,
    brush: canZoom ? {
      xAxisIndex: 0, seriesIndex: [], brushMode: 'single', transformable: false,
      brushStyle: { color: `${palette.blue}33`, borderColor: palette.blue, borderWidth: 1 },
    } : undefined,
    dataZoom: canZoom ? [{ id: CATEGORY_ZOOM_ID, type: 'inside', xAxisIndex: 0, filterMode: 'filter', disabled: true }] : undefined,
    xAxis: {
      type: 'category', name: fieldTitle(category?.label ?? ''), nameLocation: 'middle', nameGap: 29,
      nameTextStyle: { color: colors.text.default, fontWeight: 600 },
      data: categories,
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
    series: measures.map(({ id, name, values }) => kind === 'bar'
      ? { id, name, type: 'bar', barMaxWidth: 48, data: values }
      : {
        id, name, type: 'line', connectNulls: false, showSymbol: categories.length <= 80,
        areaStyle: kind === 'area' ? { opacity: isSplit ? 0.15 : 0.2 } : undefined,
        data: values,
      }),
  }

  function resetZoom() {
    const chart = chartRef.current?.getEchartsInstance()
    chart?.dispatchAction({ type: 'brush', areas: [] })
    chart?.dispatchAction({
      type: 'dataZoom', dataZoomId: CATEGORY_ZOOM_ID, start: 0, end: 100,
    })
  }

  function enableZoomDrag(chart: EChartsType) {
    setZoomedChartKey(null)
    chart.dispatchAction({ type: 'takeGlobalCursor', key: 'brush', brushOption: { brushType: 'lineX' } })
  }

  function updateZoomState(_event: unknown, chart: EChartsType) {
    const zoom = chart.getOption().dataZoom
    const range = Array.isArray(zoom) ? zoom.find(({ id }) => id === CATEGORY_ZOOM_ID) : undefined
    setZoomedChartKey(range && (range.start > 0 || range.end < 100) ? chartKey : null)
  }

  function selectField(axis: keyof ChartAxes, label: string) {
    const field = fields.find((candidate) => candidate.label === label)
    onAxesChange({ ...axes, xColumn: category?.key, yColumn: measure?.key, [axis]: field?.key })
  }

  return (
    <div className="chart-view">
      <div className="chart-controls">
        <label>{isPie ? 'Slice label' : 'Category'}
          <select value={category?.label ?? ''} onChange={(event) => selectField('xColumn', event.target.value)}>
            <option value="" disabled>Select a column</option>
            {fields.map(({ index, label }) => <option key={index} value={label}>{label}</option>)}
          </select>
        </label>
        <label>{isPie ? 'Slice size' : 'Measure'}
          <select value={measure?.label ?? ''} onChange={(event) => selectField('yColumn', event.target.value)} disabled={numericFields.length === 0}>
            <option value="" disabled>Select a numeric column</option>
            {numericFields.map(({ index, label }) => <option key={index} value={label}>{label}</option>)}
          </select>
        </label>
        {/* {!isPie && <label>Split by
          <select value={splitField?.label ?? ''} onChange={(event) => selectField('splitColumn', event.target.value)} disabled={splitFields.length === 0}>
            <option value="">None</option>
            {splitFields.map(({ index, label }) => <option key={index} value={label}>{label}</option>)}
          </select>
        </label>} */}
        {canZoom && !message && <button type="button" className="chart-reset-zoom disabled:opacity-50" disabled={zoomedChartKey !== chartKey} onClick={resetZoom}>Reset zoom</button>}
      </div>
      <div className="chart-stage">
        {message ? <div className="empty-state"><h3>Set up your chart</h3><p>{message}</p></div>
          : <ReactEChartsCore key={chartKey} ref={chartRef} echarts={echarts} option={option}
              onChartReady={canZoom ? enableZoomDrag : undefined} onEvents={canZoom ? { brushEnd: zoomToBrush, datazoom: updateZoomState } : undefined}
              autoResize style={{ height: '100%', width: '100%' }} />}
      </div>
      {missingCount > 0 && <p className="chart-data-note" role="status">{missingCount.toLocaleString()} {missingCount === 1 ? 'value is' : 'values are'} missing, nonnumeric, or outside the safe numeric range. {isPie ? 'These rows are omitted.' : 'These appear as gaps.'}</p>}
    </div>
  )
}
