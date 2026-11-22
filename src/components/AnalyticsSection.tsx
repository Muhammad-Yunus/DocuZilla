import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Calendar,
  Database,
  FileText,
  PieChart,
  X,
} from 'lucide-react';
import type { AnalyticsCardData, WorkspaceTab } from '../types/docuzilla.ts';

interface AnalyticsSectionProps {
  analytics: Record<string, AnalyticsCardData>;
  onOpenWorkspace: (tab: WorkspaceTab) => void;
}

function MiniBarChart({
  bars,
  color,
  minLabel,
  maxLabel,
}: {
  bars: number[];
  color: string;
  minLabel?: string;
  maxLabel?: string;
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  return (
    <div className="mt-4">
      <div className="relative h-14 flex items-end justify-between gap-[3px]">
        {bars.map((val, idx) => {
          const isHovered = hoveredIdx === idx;
          return (
            <div
              key={idx}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              className="relative flex-1 h-full flex items-end justify-center cursor-pointer"
            >
              {isHovered && (
                <div className="absolute -top-6 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-slate-900 text-white text-[10px] font-medium tabular-nums whitespace-nowrap z-20 pointer-events-none">
                  {val}%
                </div>
              )}
              <div
                className="w-[2.5px] sm:w-[3px] rounded-t-full transition-opacity duration-150"
                style={{
                  height: `${Math.max(14, val)}%`,
                  backgroundColor: color,
                  opacity: isHovered ? 1 : idx > 14 ? 0.45 : 0.9,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10.5px] text-slate-400 tabular-nums">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}

function AccountMetricsBarChart({
  bars,
  redIndices = [],
  pins = [],
}: {
  bars: number[];
  redIndices?: number[];
  pins?: Array<{ index: number; type: 'up' | 'down'; label: string }>;
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  return (
    <div className="relative mt-6 h-20 flex items-end justify-between gap-[2.5px] sm:gap-[3px]">
      {bars.map((val, idx) => {
        const isRed = redIndices.includes(idx);
        const isMuted = idx >= 20;
        const pin = pins.find((p) => p.index === idx);
        const isHovered = hoveredIdx === idx;

        const barColor = isRed ? '#EF4444' : isMuted ? '#E5E7EB' : '#2563EB';

        return (
          <div
            key={idx}
            onMouseEnter={() => setHoveredIdx(idx)}
            onMouseLeave={() => setHoveredIdx(null)}
            className="relative flex-1 h-full flex items-end justify-center cursor-pointer"
          >
            {pin && (
              <div
                title={pin.label}
                className={`absolute z-10 w-[18px] h-[18px] rounded-full flex items-center justify-center shadow-sm ${
                  pin.type === 'up'
                    ? 'bg-[#22C55E] text-white'
                    : 'bg-[#EF4444] text-white'
                }`}
                style={{
                  bottom: `calc(${Math.max(12, val)}% + 5px)`,
                }}
              >
                {pin.type === 'up' ? (
                  <ArrowUpRight className="w-2.5 h-2.5" strokeWidth={2.5} />
                ) : (
                  <ArrowDownRight className="w-2.5 h-2.5" strokeWidth={2.5} />
                )}
              </div>
            )}

            {isHovered && (
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-slate-900 text-white text-[10px] font-medium tabular-nums whitespace-nowrap z-30 pointer-events-none">
                {pin ? pin.label : `Day ${idx + 1}: ${val}%`}
              </div>
            )}

            <div
              className="w-[2.5px] sm:w-[3px] rounded-t-full transition-opacity duration-150"
              style={{
                height: `${Math.max(12, val)}%`,
                backgroundColor: barColor,
                opacity: isHovered ? 1 : isMuted ? 0.75 : 0.92,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

function SubMetricBadge({ badge }: { badge: 'up' | 'alert' | 'warn' }) {
  if (badge === 'up') {
    return (
      <span className="w-4 h-4 rounded-full bg-[#22C55E] text-white inline-flex items-center justify-center shrink-0">
        <ArrowUpRight className="w-2.5 h-2.5" strokeWidth={2.6} />
      </span>
    );
  }
  if (badge === 'alert') {
    return (
      <span className="w-4 h-4 rounded-full bg-[#EF4444] text-white inline-flex items-center justify-center shrink-0">
        <AlertTriangle className="w-2.5 h-2.5" strokeWidth={2.4} />
      </span>
    );
  }
  return (
    <span className="w-4 h-4 rounded-full bg-[#F59E0B] text-white inline-flex items-center justify-center shrink-0">
      <X className="w-2.5 h-2.5" strokeWidth={2.6} />
    </span>
  );
}

export const AnalyticsSection: React.FC<AnalyticsSectionProps> = ({
  analytics,
  onOpenWorkspace,
}) => {
  const uploads = analytics.document_uploads || {
    headlineValue: '72,52%',
    deltaDirection: 'up',
    series: {
      minLabel: '15.6K',
      maxLabel: '17K',
      bars: [22, 34, 42, 38, 52, 64, 72, 85, 78, 92, 80, 68, 76, 62, 54, 48, 58, 46, 36, 42, 34, 28],
    },
    subMetrics: null,
  };

  const processed = analytics.data_processed || {
    headlineValue: '61,23%',
    deltaDirection: 'up',
    series: {
      minLabel: '183 GB',
      maxLabel: '240 GB',
      bars: [18, 28, 36, 48, 58, 74, 88, 92, 84, 76, 82, 74, 68, 62, 56, 48, 42, 38, 32, 26, 22, 18],
    },
    subMetrics: null,
  };

  const discrepancies = analytics.discrepancies || {
    headlineValue: '13,78%',
    deltaDirection: 'down',
    series: {
      minLabel: '2.9K',
      maxLabel: '11.5K',
      bars: [32, 46, 58, 76, 84, 92, 82, 74, 68, 72, 64, 58, 54, 46, 40, 34, 30, 26, 22, 18, 16, 14],
    },
    subMetrics: null,
  };

  const closures = analytics.month_closures || {
    headlineValue: '77,24%',
    deltaDirection: 'up',
    series: {
      bars: [10, 18, 32, 16, 42, 26, 44, 58, 76, 62, 34, 88, 66, 48, 36, 68, 84, 94, 82, 72, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12],
      redIndices: [8, 11],
      pins: [
        { index: 4, type: 'up', label: 'Q1 Timely +12%' },
        { index: 11, type: 'down', label: 'Variance spike -4.2%' },
        { index: 19, type: 'up', label: 'Close velocity +18%' },
      ],
    },
    subMetrics: [
      { value: '88', label: 'Closed', badge: 'up' },
      { value: '19', label: 'Open', badge: 'alert' },
      { value: '19/5', label: 'Timely', badge: 'warn' },
      { value: '84/0', label: 'On Time', badge: 'up' },
    ],
  };

  const usage = analytics.usage_rate || {
    headlineValue: '46,36%',
    deltaDirection: 'up',
    series: {
      bars: [12, 22, 18, 28, 14, 34, 24, 46, 62, 84, 52, 74, 42, 24, 38, 48, 66, 78, 92, 68, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12],
      redIndices: [9, 13],
      pins: [
        { index: 6, type: 'up', label: 'Sync throughput +14%' },
        { index: 13, type: 'down', label: 'Retry threshold' },
        { index: 19, type: 'up', label: 'Retrieval peak +21%' },
      ],
    },
    subMetrics: [
      { value: '56%', label: 'Syncs Accounts', badge: 'up' },
      { value: '11%', label: 'Auto Send', badge: 'alert' },
      { value: '32%', label: 'Manual Send', badge: 'warn' },
      { value: '74%', label: 'Retrieval', badge: 'up' },
    ],
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Row 1: 3 Compact Trend Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Document Uploads */}
        <div className="bg-white rounded-[22px] p-5 shadow-[0_2px_16px_rgba(15,23,42,0.03)] border border-slate-100/80 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-[10px] bg-[#EEF4FF] flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4 text-[#3B66F5]" strokeWidth={1.8} />
                </div>
                <span className="text-[13.5px] font-medium text-slate-800 truncate">
                  Document Uploads
                </span>
              </div>
              <button
                type="button"
                onClick={() => onOpenWorkspace('documents')}
                className="w-7 h-7 rounded-full border border-slate-100 bg-slate-50/70 hover:bg-slate-100 flex items-center justify-center text-slate-600 transition-colors cursor-pointer shrink-0"
                aria-label="Explore Document Uploads"
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="mt-3 text-[11px] text-slate-400">Last 7 days</div>
            <div className="mt-1 flex items-center gap-2.5">
              <span className="text-[28px] sm:text-[31px] font-normal tracking-tight text-slate-900 tabular-nums leading-none">
                {uploads.headlineValue}
              </span>
              <span className="w-5 h-5 rounded-full bg-[#22C55E] text-white inline-flex items-center justify-center shrink-0">
                <ArrowUpRight className="w-3 h-3" strokeWidth={2.5} />
              </span>
            </div>
          </div>

          <MiniBarChart
            bars={uploads.series.bars}
            color="#3563E9"
            minLabel={uploads.series.minLabel}
            maxLabel={uploads.series.maxLabel}
          />
        </div>

        {/* Data Processed */}
        <div className="bg-white rounded-[22px] p-5 shadow-[0_2px_16px_rgba(15,23,42,0.03)] border border-slate-100/80 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-[10px] bg-[#EEF4FF] flex items-center justify-center shrink-0">
                  <Database className="w-4 h-4 text-[#3B66F5]" strokeWidth={1.8} />
                </div>
                <span className="text-[13.5px] font-medium text-slate-800 truncate">
                  Data Processed
                </span>
              </div>
              <button
                type="button"
                onClick={() => onOpenWorkspace('analytics')}
                className="w-7 h-7 rounded-full border border-slate-100 bg-slate-50/70 hover:bg-slate-100 flex items-center justify-center text-slate-600 transition-colors cursor-pointer shrink-0"
                aria-label="Explore Data Processed"
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="mt-3 text-[11px] text-slate-400">Last 7 days</div>
            <div className="mt-1 flex items-center gap-2.5">
              <span className="text-[28px] sm:text-[31px] font-normal tracking-tight text-slate-900 tabular-nums leading-none">
                {processed.headlineValue}
              </span>
              <span className="w-5 h-5 rounded-full bg-[#22C55E] text-white inline-flex items-center justify-center shrink-0">
                <ArrowUpRight className="w-3 h-3" strokeWidth={2.5} />
              </span>
            </div>
          </div>

          <MiniBarChart
            bars={processed.series.bars}
            color="#22C55E"
            minLabel={processed.series.minLabel}
            maxLabel={processed.series.maxLabel}
          />
        </div>

        {/* Discrepancies */}
        <div className="bg-white rounded-[22px] p-5 shadow-[0_2px_16px_rgba(15,23,42,0.03)] border border-slate-100/80 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-[10px] bg-[#FEF2F2] flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-4 h-4 text-[#EF4444]" strokeWidth={1.8} />
                </div>
                <span className="text-[13.5px] font-medium text-slate-800 truncate">
                  Discrepancies
                </span>
              </div>
              <button
                type="button"
                onClick={() => onOpenWorkspace('approvals')}
                className="w-7 h-7 rounded-full border border-slate-100 bg-slate-50/70 hover:bg-slate-100 flex items-center justify-center text-slate-600 transition-colors cursor-pointer shrink-0"
                aria-label="Explore Discrepancies"
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="mt-3 text-[11px] text-slate-400">Last 7 days</div>
            <div className="mt-1 flex items-center gap-2.5">
              <span className="text-[28px] sm:text-[31px] font-normal tracking-tight text-slate-900 tabular-nums leading-none">
                {discrepancies.headlineValue}
              </span>
              <span className="w-5 h-5 rounded-full bg-[#EF4444] text-white inline-flex items-center justify-center shrink-0">
                <ArrowDownRight className="w-3 h-3" strokeWidth={2.5} />
              </span>
            </div>
          </div>

          <MiniBarChart
            bars={discrepancies.series.bars}
            color="#EAB308"
            minLabel={discrepancies.series.minLabel}
            maxLabel={discrepancies.series.maxLabel}
          />
        </div>
      </div>

      {/* Row 2: 2 Detailed Account Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">
        {/* On-Time Month Closures */}
        <div className="bg-white rounded-[22px] p-5 sm:p-6 shadow-[0_2px_16px_rgba(15,23,42,0.03)] border border-slate-100/80 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-[10px] bg-[#EEF4FF] flex items-center justify-center shrink-0">
                  <Calendar className="w-4 h-4 text-[#3B66F5]" strokeWidth={1.8} />
                </div>
                <span className="text-[14px] font-medium text-slate-800 truncate">
                  On-Time Month Closures
                </span>
              </div>
              <button
                type="button"
                onClick={() => onOpenWorkspace('analytics')}
                className="w-7 h-7 rounded-full border border-slate-100 bg-slate-50/70 hover:bg-slate-100 flex items-center justify-center text-slate-600 transition-colors cursor-pointer shrink-0"
                aria-label="Inspect On-Time Month Closures"
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="mt-3 text-[11px] text-slate-400">Typical Account Metrics</div>

            <div className="mt-2 flex items-start justify-between gap-4">
              <div className="text-[30px] sm:text-[34px] font-normal tracking-tight text-slate-900 tabular-nums leading-none pt-1">
                {closures.headlineValue}
              </div>

              <div className="grid grid-cols-2 gap-x-5 gap-y-2.5 shrink-0">
                {(closures.subMetrics || []).map((item) => (
                  <div key={item.label} className="leading-tight">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13.5px] font-medium text-slate-900 tabular-nums">
                        {item.value}
                      </span>
                      <SubMetricBadge badge={item.badge} />
                    </div>
                    <div className="text-[10.5px] text-slate-400 mt-0.5">{item.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <AccountMetricsBarChart
            bars={closures.series.bars}
            redIndices={closures.series.redIndices}
            pins={closures.series.pins}
          />
        </div>

        {/* Usage Rate */}
        <div className="bg-white rounded-[22px] p-5 sm:p-6 shadow-[0_2px_16px_rgba(15,23,42,0.03)] border border-slate-100/80 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-[10px] bg-[#EEF4FF] flex items-center justify-center shrink-0">
                  <PieChart className="w-4 h-4 text-[#3B66F5]" strokeWidth={1.8} />
                </div>
                <span className="text-[14px] font-medium text-slate-800 truncate">
                  Usage Rate
                </span>
              </div>
              <button
                type="button"
                onClick={() => onOpenWorkspace('analytics')}
                className="w-7 h-7 rounded-full border border-slate-100 bg-slate-50/70 hover:bg-slate-100 flex items-center justify-center text-slate-600 transition-colors cursor-pointer shrink-0"
                aria-label="Inspect Usage Rate"
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="mt-3 text-[11px] text-slate-400">Typical Account Metrics</div>

            <div className="mt-2 flex items-start justify-between gap-4">
              <div className="text-[30px] sm:text-[34px] font-normal tracking-tight text-slate-900 tabular-nums leading-none pt-1">
                {usage.headlineValue}
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 shrink-0">
                {(usage.subMetrics || []).map((item) => (
                  <div key={item.label} className="leading-tight">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13.5px] font-medium text-slate-900 tabular-nums">
                        {item.value}
                      </span>
                      <SubMetricBadge badge={item.badge} />
                    </div>
                    <div className="text-[10.5px] text-slate-400 mt-0.5 whitespace-nowrap">
                      {item.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <AccountMetricsBarChart
            bars={usage.series.bars}
            redIndices={usage.series.redIndices}
            pins={usage.series.pins}
          />
        </div>
      </div>
    </div>
  );
};
