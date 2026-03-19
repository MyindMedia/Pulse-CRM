'use client'

import { MoreHorizontal, ArrowUpRight, ChevronRight } from 'lucide-react'

export function StageFunnel() {
  return (
    <div className="bg-white/40 backdrop-blur-xl rounded-[40px] border border-white/60 p-6 flex flex-col shadow-sm h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-slate-800">Stage Funnel</h3>
        <div className="flex items-center gap-2">
          <button className="flex items-center justify-center size-8 rounded-full border border-slate-200 bg-white/50 text-slate-500 hover:bg-slate-100 transition">
            <MoreHorizontal className="size-4" />
          </button>
          <button className="flex items-center justify-center size-8 rounded-full border border-slate-200 bg-white/50 text-slate-500 hover:bg-slate-100 transition">
            <ArrowUpRight className="size-4" />
          </button>
        </div>
      </div>

      <div className="flex items-end justify-between mb-8 px-2">
        <div>
          <p className="text-2xl font-bold text-slate-800 tracking-tight">$350,500</p>
          <p className="text-xs font-medium text-slate-500">Total in Pipeline</p>
        </div>
        <div className="flex bg-slate-200/50 p-1 rounded-full border border-slate-200 shadow-inner">
           <button className="px-3 py-1 rounded-full text-xs font-medium bg-white text-slate-700 shadow-sm border border-slate-100">Weighted</button>
           <button className="px-3 py-1 rounded-full text-xs font-medium text-slate-500 hover:text-slate-700">Total</button>
        </div>
      </div>

      <div className="flex flex-col gap-4 mt-auto">
        {/* Funnel Stage 1 */}
        <div className="flex items-center justify-between">
          <div className="bg-white/60 w-[80%] rounded-r-3xl rounded-l-md py-3 px-5 border border-white shadow-sm flex items-center justify-between relative group hover:bg-white/80 transition cursor-pointer">
            <div>
              <p className="text-xs font-medium text-slate-400 mb-0.5">Qualification</p>
              <p className="font-semibold text-slate-700">92,350$</p>
            </div>
            <div className="absolute right-4 text-slate-300 group-hover:text-slate-500 flex -rotate-45">
               <ArrowUpRight className="size-4" />
            </div>
          </div>
        </div>
        
        {/* Funnel Stage 2 - Indented */}
        <div className="flex items-center justify-between pl-6 h-[72px]">
          <div className="bg-white/60 w-[85%] rounded-r-3xl rounded-l-md py-3 px-5 border border-white shadow-sm flex items-center justify-between relative group hover:bg-white/80 transition cursor-pointer">
            <div>
              <p className="text-xs font-medium text-slate-400 mb-0.5">Royal Package Opportunity</p>
              <p className="font-semibold text-slate-700">67,120$</p>
            </div>
            <div className="absolute right-4 text-slate-300 group-hover:text-slate-500 flex -rotate-45">
               <ArrowUpRight className="size-4" />
            </div>
          </div>
        </div>

        {/* Funnel Stage 3 - Further indented */}
        <div className="flex items-center justify-between pl-12 h-[72px]">
          <div className="bg-white/60 w-[90%] rounded-r-3xl rounded-l-md py-3 px-5 border border-white shadow-sm flex items-center justify-between relative group hover:bg-white/80 transition cursor-pointer">
            <div>
              <p className="text-xs font-medium text-slate-400 mb-0.5">Value Proposition</p>
              <p className="font-semibold text-slate-700">28,980$</p>
            </div>
            <div className="absolute right-4 text-slate-300 group-hover:text-slate-500 flex -rotate-45">
               <ArrowUpRight className="size-4" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
