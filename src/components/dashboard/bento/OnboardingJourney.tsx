import { RadialGauge } from '@/components/ui/radial-gauge'
import { MoreHorizontal, ArrowUpRight, CheckCircle2, Circle } from 'lucide-react'

export function OnboardingJourney() {
  return (
    <div className="bg-white/40 backdrop-blur-xl rounded-[40px] border border-white/60 p-6 flex flex-col shadow-sm">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-semibold text-slate-800">Onboarding Journey</h3>
          <p className="text-xs text-slate-500 mt-0.5">Average completion status</p>
        </div>
        <div className="flex items-center gap-1.5 text-slate-400">
          <button className="flex items-center justify-center size-8 rounded-full border border-slate-200 bg-white/50 text-slate-500 hover:bg-slate-100 transition">
            <MoreHorizontal className="size-4" />
          </button>
          <button className="flex items-center justify-center size-8 rounded-full border border-slate-200 bg-white/50 text-slate-500 hover:bg-slate-100 transition">
            <ArrowUpRight className="size-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center mb-6 mt-2">
         <RadialGauge
            value={75}
            max={100}
            size={200}
            strokeWidth={14}
            grade="Phase 3"
            trend="up"
            trendLabel="On Track"
            colorClass="text-[#EAB308]"
          />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between p-2.5 rounded-2xl bg-white/50 border border-white/60">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="size-5 text-emerald-500" />
            <span className="text-sm font-medium text-slate-700">Account Setup</span>
          </div>
          <span className="text-xs font-semibold text-slate-400 bg-slate-100 px-2 py-1 rounded-full text-[10px] uppercase">Done</span>
        </div>
        <div className="flex items-center justify-between p-2.5 rounded-2xl bg-white/50 border border-white/60">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="size-5 text-emerald-500" />
            <span className="text-sm font-medium text-slate-700">Integration</span>
          </div>
          <span className="text-xs font-semibold text-slate-400 bg-slate-100 px-2 py-1 rounded-full text-[10px] uppercase">Done</span>
        </div>
        <div className="flex items-center justify-between p-2.5 rounded-2xl bg-[#FEFCE8]/50 border border-[#FEF9C3] relative overflow-hidden group">
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#FEFCE8]0 rounded-l-2xl"></div>
          <div className="flex items-center gap-3 pl-2">
            <Circle className="size-5 text-[#EAB308] stroke-[3]" />
            <span className="text-sm font-medium text-[#713F12]">Team Training</span>
          </div>
          <span className="text-xs font-semibold text-[#FACC15] bg-[#FEF9C3] px-2 py-1 rounded-full text-[10px] uppercase">In Progress</span>
        </div>
      </div>
    </div>
  )
}
