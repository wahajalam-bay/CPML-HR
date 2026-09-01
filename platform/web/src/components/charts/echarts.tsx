"use client";

import * as React from "react";
import * as echarts from "echarts/core";
import { SankeyChart, TreemapChart, BoxplotChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  DatasetComponent,
  TitleComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsCoreOption } from "echarts/core";
import { useTheme } from "next-themes";
import { cn, fmtInt, fmtPct } from "@/lib/utils";
import { seriesColor } from "./chart-kit";

echarts.use([
  SankeyChart,
  TreemapChart,
  BoxplotChart,
  GridComponent,
  TooltipComponent,
  DatasetComponent,
  TitleComponent,
  CanvasRenderer,
]);

/* =========================================================================
 * Base wrapper — handles instance lifecycle, resize and theme repaint
 * ========================================================================= */

function useCssVar(name: string, deps: unknown[] = []): string {
  const [value, setValue] = React.useState("");
  React.useEffect(() => {
    setValue(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

export function ECharts({
  option,
  height = 320,
  className,
  onEvent,
  notMerge = true,
}: {
  option: EChartsCoreOption;
  height?: number;
  className?: string;
  onEvent?: { type: string; handler: (params: unknown) => void }[];
  notMerge?: boolean;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const instance = React.useRef<echarts.ECharts | null>(null);
  const { resolvedTheme } = useTheme();

  React.useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: "canvas" });
    instance.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      instance.current = null;
    };
  }, []);

  React.useEffect(() => {
    instance.current?.setOption(option, { notMerge });
  }, [option, notMerge, resolvedTheme]);

  React.useEffect(() => {
    const chart = instance.current;
    if (!chart || !onEvent) return;
    for (const { type, handler } of onEvent) chart.on(type, handler);
    return () => {
      for (const { type } of onEvent) chart.off(type);
    };
  }, [onEvent]);

  return <div ref={ref} className={cn("w-full", className)} style={{ height }} />;
}

/* =========================================================================
 * Sankey — where candidates actually flow, and where they leave
 * ========================================================================= */

export interface FlowNode {
  name: string;
  depth?: number;
  tone?: "stage" | "loss" | "win";
}
export interface FlowLink {
  source: string;
  target: string;
  value: number;
}

export function SankeyFlow({
  nodes,
  links,
  height = 420,
  onNodeClick,
  className,
}: {
  nodes: FlowNode[];
  links: FlowLink[];
  height?: number;
  onNodeClick?: (name: string) => void;
  className?: string;
}) {
  const ink = useCssVar("--ink");
  const ink3 = useCssVar("--ink-3");
  const surface = useCssVar("--surface");
  const good = useCssVar("--good");
  const critical = useCssVar("--critical");
  const { resolvedTheme } = useTheme();

  const option = React.useMemo<EChartsCoreOption>(() => {
    const colorFor = (n: FlowNode, i: number) =>
      n.tone === "loss" ? critical : n.tone === "win" ? good : seriesColorHex(i, resolvedTheme === "dark");

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        triggerOn: "mousemove",
        backgroundColor: surface,
        borderColor: "rgba(0,0,0,0.1)",
        borderWidth: 1,
        padding: [8, 10],
        textStyle: { color: ink, fontSize: 11 },
        formatter: (p: { dataType: string; name?: string; data?: { source?: string; target?: string }; value?: number }) => {
          if (p.dataType === "edge") {
            return `<b>${p.data?.source}</b> → <b>${p.data?.target}</b><br/>${fmtInt(Number(p.value))} candidates`;
          }
          return `<b>${p.name}</b><br/>${fmtInt(Number(p.value))} candidates`;
        },
      },
      series: [
        {
          type: "sankey",
          left: 10,
          right: 118,
          top: 14,
          bottom: 14,
          nodeWidth: 11,
          nodeGap: 16,
          nodeAlign: "left",
          emphasis: { focus: "adjacency" },
          data: nodes.map((n, i) => ({
            name: n.name,
            depth: n.depth,
            itemStyle: { color: colorFor(n, i), borderWidth: 0 },
            label: {
              color: n.tone === "loss" ? critical : ink,
              fontSize: 10,
              fontWeight: n.tone === "loss" ? 400 : 600,
              // Loss arms hang off the bottom of a stage, so their labels are
              // pushed to the opposite side of the node from the stage label
              // they would otherwise collide with.
              position: n.tone === "loss" ? "bottom" : "right",
            },
          })),
          links: links.map((l) => ({ ...l })),
          lineStyle: { color: "gradient", opacity: 0.26, curveness: 0.5 },
          label: {
            color: ink3,
            fontSize: 10,
            formatter: (p: { name: string }) =>
              p.name.startsWith("Left at ") ? `↓ ${p.name.slice(8)}` : p.name,
          },
        },
      ],
    };
  }, [nodes, links, ink, ink3, surface, good, critical, resolvedTheme]);

  const events = React.useMemo(
    () =>
      onNodeClick
        ? [
            {
              type: "click",
              handler: (params: unknown) => {
                const p = params as { dataType?: string; name?: string };
                if (p.dataType === "node" && p.name) onNodeClick(p.name);
              },
            },
          ]
        : undefined,
    [onNodeClick],
  );

  return <ECharts option={option} height={height} className={className} onEvent={events} />;
}

/* =========================================================================
 * Treemap — proportional composition where a bar list would run too long
 * ========================================================================= */

export function Treemap({
  data,
  height = 320,
  onLeafClick,
  className,
  valueLabel = "candidates",
}: {
  data: { name: string; value: number; children?: { name: string; value: number }[] }[];
  height?: number;
  onLeafClick?: (name: string) => void;
  className?: string;
  valueLabel?: string;
}) {
  const ink = useCssVar("--ink");
  const surface = useCssVar("--surface");
  const { resolvedTheme } = useTheme();

  const total = React.useMemo(() => data.reduce((s, d) => s + d.value, 0), [data]);

  const option = React.useMemo<EChartsCoreOption>(
    () => ({
      backgroundColor: "transparent",
      tooltip: {
        backgroundColor: surface,
        borderColor: "rgba(0,0,0,0.1)",
        borderWidth: 1,
        padding: [8, 10],
        textStyle: { color: ink, fontSize: 11 },
        formatter: (p: { name: string; value: number }) =>
          `<b>${p.name}</b><br/>${fmtInt(p.value)} ${valueLabel}<br/>${fmtPct((p.value / (total || 1)) * 100)} of total`,
      },
      series: [
        {
          type: "treemap",
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          top: 2, left: 2, right: 2, bottom: 2,
          itemStyle: { borderColor: surface, borderWidth: 2, gapWidth: 2 },
          label: {
            show: true,
            color: "#fff",
            fontSize: 11,
            fontWeight: 500,
            overflow: "truncate",
            formatter: (p: { name: string; value: number }) =>
              `${p.name}\n${fmtInt(p.value)}`,
          },
          upperLabel: { show: false },
          levels: [
            {
              itemStyle: { borderWidth: 2, borderColor: surface, gapWidth: 2 },
            },
          ],
          data: data.map((d, i) => ({
            ...d,
            itemStyle: { color: seriesColorHex(i, resolvedTheme === "dark") },
          })),
        },
      ],
    }),
    [data, ink, surface, total, valueLabel, resolvedTheme],
  );

  const events = React.useMemo(
    () =>
      onLeafClick
        ? [
            {
              type: "click",
              handler: (params: unknown) => {
                const p = params as { name?: string };
                if (p.name) onLeafClick(p.name);
              },
            },
          ]
        : undefined,
    [onLeafClick],
  );

  return <ECharts option={option} height={height} className={className} onEvent={events} />;
}

/* =========================================================================
 * Box plot — distribution comparison across groups
 * ========================================================================= */

export function BoxPlot({
  groups,
  height = 280,
  unit = "d",
  className,
}: {
  groups: { label: string; values: number[] }[];
  height?: number;
  unit?: string;
  className?: string;
}) {
  const ink = useCssVar("--ink");
  const ink3 = useCssVar("--ink-3");
  const surface = useCssVar("--surface");
  const grid = useCssVar("--grid");
  const axis = useCssVar("--axis");

  const option = React.useMemo<EChartsCoreOption>(() => {
    const boxes = groups.map((g) => {
      const v = [...g.values].sort((a, b) => a - b);
      if (!v.length) return [0, 0, 0, 0, 0];
      const q = (p: number) => {
        const idx = (v.length - 1) * p;
        const lo = Math.floor(idx);
        const hi = Math.ceil(idx);
        return lo === hi ? v[lo] : v[lo] + (v[hi] - v[lo]) * (idx - lo);
      };
      const q1 = q(0.25);
      const q3 = q(0.75);
      const iqr = q3 - q1;
      return [
        Math.max(v[0], q1 - 1.5 * iqr),
        q1,
        q(0.5),
        q3,
        Math.min(v[v.length - 1], q3 + 1.5 * iqr),
      ];
    });

    return {
      backgroundColor: "transparent",
      grid: { left: 8, right: 12, top: 12, bottom: 24, containLabel: true },
      tooltip: {
        trigger: "item",
        backgroundColor: surface,
        borderColor: "rgba(0,0,0,0.1)",
        borderWidth: 1,
        padding: [8, 10],
        textStyle: { color: ink, fontSize: 11 },
        formatter: (p: { name: string; value: number[] }) =>
          `<b>${p.name}</b><br/>` +
          `Max ${p.value[5]?.toFixed(0)}${unit}<br/>` +
          `Upper quartile ${p.value[4]?.toFixed(0)}${unit}<br/>` +
          `<b>Median ${p.value[3]?.toFixed(0)}${unit}</b><br/>` +
          `Lower quartile ${p.value[2]?.toFixed(0)}${unit}<br/>` +
          `Min ${p.value[1]?.toFixed(0)}${unit}`,
      },
      xAxis: {
        type: "category",
        data: groups.map((g) => g.label),
        axisLine: { lineStyle: { color: axis } },
        axisTick: { show: false },
        axisLabel: { color: ink3, fontSize: 11, interval: 0, rotate: groups.length > 7 ? 30 : 0 },
      },
      yAxis: {
        type: "value",
        splitLine: { lineStyle: { color: grid } },
        axisLine: { show: false },
        axisLabel: { color: ink3, fontSize: 11, formatter: `{value}${unit}` },
      },
      series: [
        {
          type: "boxplot",
          data: boxes,
          itemStyle: { color: "transparent", borderColor: seriesColorHex(0, false), borderWidth: 1.5 },
          boxWidth: [10, 34],
        },
      ],
    };
  }, [groups, ink, ink3, surface, grid, axis, unit]);

  return <ECharts option={option} height={height} className={className} />;
}

/* =========================================================================
 * ECharts renders to canvas and cannot read CSS custom properties, so the
 * categorical palette is mirrored here as literal hex — the same validated
 * values as globals.css, kept in one place per mode.
 * ========================================================================= */

const SERIES_LIGHT = [
  "#188748", "#196fb7", "#d67608", "#b40b56", "#6910d8", "#da0817",
];
const SERIES_DARK = [
  "#2f9e5a", "#267ecb", "#d57610", "#e02971", "#8238fd", "#f42427",
];

export function seriesColorHex(i: number, dark: boolean): string {
  const palette = dark ? SERIES_DARK : SERIES_LIGHT;
  return palette[Math.min(i, palette.length - 1)];
}

export { seriesColor };
