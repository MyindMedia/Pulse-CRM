'use client'

import { MoreHorizontal, ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

export function TasksSchedule() {
  return (
    <div className="bg-white/40 backdrop-blur-xl rounded-[40px] border border-white/60 p-6 flex flex-col shadow-sm h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-slate-800">Tasks Schedule</h3>
        <div className="flex items-center gap-2">
          <button className="flex items-center justify-center size-8 rounded-full border border-slate-200 bg-white/50 text-slate-500 hover:bg-slate-100 transition">
            <MoreHorizontal className="size-4" />
          </button>
          <button className="flex items-center justify-center size-8 rounded-full border border-slate-200 bg-white/50 text-slate-500 hover:bg-slate-100 transition">
            <ArrowUpRight className="size-4" />
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between mb-4 px-2">
        <div className="flex bg-white/60 rounded-full p-1 border border-slate-200 shadow-sm">
          <button className="flex items-center justify-center size-8 rounded-full text-slate-500 hover:bg-white transition"><ChevronLeft className="size-4" /></button>
          <button className="flex items-center justify-center size-8 rounded-full text-slate-500 hover:bg-white transition"><ChevronRight className="size-4" /></button>
        </div>
        <h4 className="font-bold text-lg text-slate-800">October</h4>
        <button className="flex items-center justify-center size-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition"><ArrowUpRight className="size-4" /></button>
      </div>

      {/* Mini Calendar Grid */}
      <div className="flex-1 rounded-[24px] bg-white/30 border border-white/60 p-2 shadow-inner">
        <div className="grid grid-cols-7 gap-1 h-full min-h-[180px]">
           {/* Abstract representations of days */}
           {[...Array(21)].map((_, i) => (
             <div key={i} className="flex flex-col items-center justify-start py-1 px-0.5 rounded-xl border border-transparent">
               <span className="text-[10px] font-medium text-slate-400 mb-1">{i + 1}</span>
               {i === 3 && (
                 <div className="w-full bg-[#FEFCE8]0 rounded-lg p-1 aspect-square flex items-center justify-center mt-1">
                   <Avatar className="size-4 border border-yellow-400"><AvatarFallback className="text-[8px] bg-white text-[#FACC15]">A</AvatarFallback></Avatar>
                 </div>
               )}
               {i === 10 && (
                 <div className="w-full bg-yellow-400 rounded-lg p-1 aspect-square flex items-center justify-center mt-1">
                   <Avatar className="size-4 border border-yellow-300"><AvatarFallback className="text-[8px] bg-white text-yellow-600">B</AvatarFallback></Avatar>
                 </div>
               )}
                {i === 15 && (
                 <div className="w-full bg-teal-500 rounded-lg p-1 aspect-square flex items-center justify-center mt-1">
                   <Avatar className="size-4 border border-teal-400"><AvatarFallback className="text-[8px] bg-white text-teal-600">C</AvatarFallback></Avatar>
                 </div>
               )}
               {i === 11 && (
                 <div className="w-full bg-white/60 rounded-lg p-1 aspect-square flex items-center justify-center mt-1 shadow-sm"></div>
               )}
             </div>
           ))}
        </div>
      </div>
    </div>
  )
}
