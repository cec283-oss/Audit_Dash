import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, CustomChart, LineChart, RadarChart, ScatterChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, RadarComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([BarChart, LineChart, ScatterChart, RadarChart, CustomChart, GridComponent, TooltipComponent, DataZoomComponent, LegendComponent, RadarComponent, MarkLineComponent, MarkAreaComponent, CanvasRenderer]);

type Props = {
  option: EChartsCoreOption;
  className?: string;
  onClick?: (p: echarts.ECElementEvent) => void;
  ariaLabel?: string;
};

export default function EChart({ option, className, onClick, ariaLabel }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    if (!el.current) return;
    const c = echarts.init(el.current, undefined, { renderer: 'canvas' });
    chart.current = c;
    c.on('click', (p) => clickRef.current?.(p as echarts.ECElementEvent));
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current);
    return () => { ro.disconnect(); c.dispose(); chart.current = null; };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={el} className={className} role="img" aria-label={ariaLabel} />;
}
