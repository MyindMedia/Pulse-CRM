import { RadialGauge } from '@/components/ui/radial-gauge'
import { MoreHorizontal, Maximize2, Triangle } from 'lucide-react'

export function LeadScoreWidget({ score = 90 }: { score?: number }) {
  return (
    <div className="bg-white/40 backdrop-blur-xl rounded-[40px] border border-white/60 p-6 flex flex-col shadow-sm">
      <div className="flex items-start justify-between mb-4">
        <h3 className="font-semibold text-slate-800">Lead Score</h3>
        <div className="flex items-center gap-1.5 text-slate-400">
          <button className="flex items-center justify-center size-8 rounded-full border border-slate-200 bg-white/50 text-slate-500 hover:bg-slate-100 transition">
            <MoreHorizontal className="size-4" />
          </button>
          <button className="flex items-center justify-center size-8 rounded-full border border-slate-200 bg-white/50 text-slate-500 hover:bg-slate-100 transition">
            <Maximize2 className="size-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col mb-4">
         <RadialGauge
            value={score}
            max={100}
            size={220}
            strokeWidth={16}
            grade={score >= 90 ? 'Grade A' : score >= 70 ? 'Grade B' : 'Grade C'}
            trend="steady"
            trendLabel="Steady"
            colorClass="text-emerald-500"
            className="mx-auto"
          />
      </div>

      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <Triangle className="size-3.5 text-emerald-500 fill-emerald-500 rotate-90 shrink-0 mt-0.5" />
          <p className="text-sm font-medium text-slate-600 leading-snug">
            Purchase timeframe is <span className="text-slate-900 font-semibold">next quarter</span>
          </p>
        </div>
        <div className="flex items-start gap-3">
          <Triangle className="size-3.5 text-emerald-500 fill-emerald-500 rotate-90 shrink-0 mt-0.5" />
          <p className="text-sm font-medium text-slate-600 leading-snug">
            Purchase process is <span className="text-slate-900 font-semibold">individual</span>
          </p>
        </div>
        <div className="flex items-start gap-3">
          <Triangle className="size-3.5 text-emerald-500 fill-emerald-500 rotate-90 shrink-0 mt-0.5" />
          <p className="text-sm font-medium text-slate-600 leading-snug">
            Lead is <span className="text-slate-900 font-semibold">relatively new</span>
          </p>
        </div>
        <div className="flex items-start gap-3">
          <Triangle className="size-3.5 text-emerald-500 fill-emerald-500 rotate-90 shrink-0 mt-0.5" />
          <p className="text-sm font-medium text-slate-600 leading-snug">
            Estimated budget is <span className="text-slate-900 font-semibold">$50,000.00</span>
          </p>
        </div>
      </div>
    </div>
  )
}
