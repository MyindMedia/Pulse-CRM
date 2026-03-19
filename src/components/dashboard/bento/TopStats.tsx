'use client'

import { BarChart3, User, Calendar } from 'lucide-react'

export function TopStats() {
  return (
    <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6 mb-8">
      {/* Title */}
      <div>
        <h1 className="text-4xl text-slate-800 font-semibold tracking-tight leading-tight">
          Customer<br />
          Information
        </h1>
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap gap-4">
        {/* Stat 1 */}
        <div className="flex items-center gap-4 bg-white/40 backdrop-blur-md px-5 py-3 rounded-3xl border border-white/60 shadow-sm">
          <div className="flex items-center justify-center size-12 rounded-full bg-slate-100 text-slate-600">
            <BarChart3 className="size-5" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-slate-800">$1,980,130</span>
              <span className="px-2 py-0.5 rounded-full bg-yellow-300 text-yellow-900 text-[10px] font-bold">+11% week</span>
            </div>
            <span className="text-xs font-medium text-slate-500 leading-tight mt-0.5">Won from 76 Deals<br/>This Month</span>
          </div>
        </div>

        {/* Stat 2 */}
        <div className="flex items-center gap-4 bg-white/40 backdrop-blur-md px-5 py-3 rounded-3xl border border-white/60 shadow-sm">
          <div className="flex items-center justify-center size-12 rounded-full bg-slate-100 text-slate-600">
            <User className="size-5" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-slate-800">+89</span>
              <span className="px-2 py-0.5 rounded-full bg-[#FEFCE8]0 text-white text-[10px] font-bold">+12 today</span>
            </div>
            <span className="text-xs font-medium text-slate-500 leading-tight mt-0.5">New Customer<br/>for Week</span>
          </div>
        </div>

        {/* Stat 3 */}
        <div className="flex items-center gap-4 bg-white/40 backdrop-blur-md px-5 py-3 rounded-3xl border border-white/60 shadow-sm">
          <div className="flex items-center justify-center size-12 rounded-full bg-slate-100 text-slate-600">
            <Calendar className="size-5" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-slate-800">+31</span>
              <span className="px-2 py-0.5 rounded-full bg-[#f4f7d0] text-slate-500 border border-slate-200 text-[10px] font-bold">+6 today</span>
            </div>
            <span className="text-xs font-medium text-slate-500 leading-tight mt-0.5">New Tasks<br/>for Week</span>
          </div>
        </div>
      </div>
    </div>
  )
}
