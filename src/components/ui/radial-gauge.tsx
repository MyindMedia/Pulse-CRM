import * as React from 'react'
import { cn } from '@/lib/utils'
import { ArrowRight, MoveRight, MoveUpRight, MoveDownRight } from 'lucide-react'

interface RadialGaugeProps {
  value: number
  max?: number
  size?: number
  strokeWidth?: number
  grade?: string
  trend?: 'up' | 'down' | 'steady'
  trendLabel?: string
  className?: string
  colorClass?: string
}

export function RadialGauge({
  value,
  max = 100,
  size = 180,
  strokeWidth = 14,
  grade = 'Grade A',
  trend = 'steady',
  trendLabel = 'Steady',
  className,
  colorClass = 'text-emerald-500',
}: RadialGaugeProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const percentage = Math.min(Math.max(value / max, 0), 1)
  
  // To make it look like the screenshot (dashed ring), we can use a dash array.
  // The screenshot shows small vertical dashes forming the ring.
  // a dasharray of "4 6" means 4px dash, 6px gap.
  const dashLength = 4
  const gapLength = 6
  
  // Calculate how many dashes fit in the circumference
  const totalDashesCount = Math.floor(circumference / (dashLength + gapLength))
  const adjustedGap = (circumference - (totalDashesCount * dashLength)) / totalDashesCount
  
  // Calculate completed dashes vs empty dashes
  const activeCircumference = circumference * percentage
  
  return (
    <div className={cn('relative flex flex-col items-center justify-center p-6', className)}>
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        {/* Background Track */}
        <svg fill="none" width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90 text-muted/30">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${dashLength} ${adjustedGap}`}
          />
        </svg>

        {/* Foreground Track (Masked) */}
        <svg fill="none" width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={cn('absolute inset-0 -rotate-90', colorClass)}>
          <defs>
            {/* The mask uses a solid circle with a single large dash/offset to slice the dashed path */}
            <mask id="gauge-mask">
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke="white"
                strokeWidth={strokeWidth + 2} /* slightly larger so we don't clip stroke width entirely */
                strokeLinecap="butt"
                fill="none"
                strokeDasharray={`${circumference} ${circumference}`}
                strokeDashoffset={circumference - activeCircumference}
              />
            </mask>
          </defs>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${dashLength} ${adjustedGap}`}
            mask="url(#gauge-mask)"
          />
        </svg>

        {/* Center Content */}
        <div className="absolute inset-0 flex items-center justify-center -ml-2">
          {/* Main Number + Sub details styled like the screenshot */}
          <div className="flex items-center gap-3">
            <span className="text-6xl font-light tracking-tighter text-slate-800 dark:text-slate-100 leading-none">
              {value}
            </span>
            <div className="flex flex-col items-start justify-center gap-1.5 pt-1">
              <span className="text-sm font-medium text-slate-500">{grade}</span>
              <div className="flex items-center gap-1 bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-500 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-bold">
                {trend === 'up' && <MoveUpRight className="size-3" />}
                {trend === 'down' && <MoveDownRight className="size-3" />}
                {trend === 'steady' && <MoveRight className="size-3" />}
                {trendLabel}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
