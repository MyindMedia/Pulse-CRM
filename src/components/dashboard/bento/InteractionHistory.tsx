'use client'

import { MoreHorizontal, ArrowUpRight } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

export function InteractionHistory() {
  return (
    <div className="bg-white/40 backdrop-blur-xl rounded-[40px] border border-white/60 p-6 flex flex-col gap-4 shadow-sm">
      <div className="flex items-center justify-between px-2 mb-2">
        <h3 className="font-semibold text-slate-800">Interaction History</h3>
        <div className="flex items-center gap-2">
          <button className="flex items-center justify-center size-8 rounded-full border border-slate-200 bg-white/50 text-slate-500 hover:bg-slate-100 transition">
            <MoreHorizontal className="size-4" />
          </button>
          <button className="flex items-center justify-center size-8 rounded-full border border-slate-200 bg-white/50 text-slate-500 hover:bg-slate-100 transition">
            <ArrowUpRight className="size-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Blue Card */}
        <div className="relative bg-[#2563eb] text-white p-6 rounded-[28px] overflow-hidden flex flex-col justify-between min-h-[160px] shadow-sm transform transition duration-300 hover:scale-[1.02]">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-[#FEF9C3] mb-1">Oct 4</p>
              <h4 className="font-semibold text-lg leading-tight">Royal Package<br/>Opportunity</h4>
            </div>
            <button className="flex items-center justify-center size-8 rounded-full bg-[#FEFCE8]0/50 hover:bg-[#FACC15] border border-yellow-400/50 transition">
              <MoreHorizontal className="size-4" />
            </button>
          </div>
          <div className="flex items-end justify-between mt-6">
            <span className="text-2xl font-bold tracking-tight">11,250$</span>
            <div className="flex -space-x-2">
              <Avatar className="size-8 border-2 border-[#FACC15]"><AvatarFallback className="bg-[#FEF08A] text-[#854D0E] text-xs">A</AvatarFallback></Avatar>
              <Avatar className="size-8 border-2 border-[#FACC15]"><AvatarFallback className="bg-indigo-200 text-indigo-800 text-xs">B</AvatarFallback></Avatar>
              <Avatar className="size-8 border-2 border-[#FACC15]"><AvatarFallback className="bg-sky-200 text-sky-800 text-xs">C</AvatarFallback></Avatar>
            </div>
          </div>
        </div>

        {/* Teal Card */}
        <div className="relative bg-[#3b82f6] text-white p-6 rounded-[28px] overflow-hidden flex flex-col justify-between min-h-[160px] shadow-sm transform transition duration-300 hover:scale-[1.02]" style={{ backgroundColor: '#2f889a' }}>
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-teal-100 mb-1">Oct 16</p>
              <h4 className="font-semibold text-lg leading-tight">Third Deal,<br/>Most Useful</h4>
            </div>
            <button className="flex items-center justify-center size-8 rounded-full bg-teal-500/30 hover:bg-teal-400/50 border border-teal-400/30 transition">
              <MoreHorizontal className="size-4" />
            </button>
          </div>
          <div className="flex items-end justify-between mt-6">
            <span className="text-2xl font-bold tracking-tight">21,300$</span>
            <div className="flex -space-x-2">
              <Avatar className="size-8 border-2 border-[#2f889a]"><AvatarFallback className="bg-teal-200 text-teal-900 text-xs">D</AvatarFallback></Avatar>
              <Avatar className="size-8 border-2 border-[#2f889a]"><AvatarFallback className="bg-cyan-200 text-cyan-900 text-xs">E</AvatarFallback></Avatar>
              <Avatar className="size-8 border-2 border-[#2f889a]"><AvatarFallback className="bg-emerald-200 text-emerald-900 text-xs">F</AvatarFallback></Avatar>
              <Avatar className="size-8 border-2 border-[#2f889a]"><AvatarFallback className="bg-green-200 text-green-900 text-xs">G</AvatarFallback></Avatar>
            </div>
          </div>
        </div>

        {/* Yellow Card */}
        <div className="relative bg-[#facc15] text-slate-900 p-6 rounded-[28px] overflow-hidden flex flex-col justify-between min-h-[160px] shadow-sm transform transition duration-300 hover:scale-[1.02]">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-yellow-800 mb-1">Oct 11</p>
              <h4 className="font-semibold text-lg leading-tight">Royal Package<br/>Opportunity</h4>
            </div>
            <button className="flex items-center justify-center size-8 rounded-full bg-yellow-400 hover:bg-yellow-300 border border-yellow-500/20 transition">
              <MoreHorizontal className="size-4" />
            </button>
          </div>
          <div className="flex items-end justify-between mt-6">
            <span className="text-2xl font-bold tracking-tight">4,160$</span>
            <div className="flex -space-x-2">
              <Avatar className="size-8 border-2 border-[#facc15]"><AvatarFallback className="bg-yellow-200 text-yellow-900 text-xs">H</AvatarFallback></Avatar>
              <Avatar className="size-8 border-2 border-[#facc15]"><AvatarFallback className="bg-orange-200 text-orange-900 text-xs">I</AvatarFallback></Avatar>
              <Avatar className="size-8 border-2 border-[#facc15]"><AvatarFallback className="bg-amber-200 text-amber-900 text-xs">J</AvatarFallback></Avatar>
            </div>
          </div>
        </div>

        {/* Black Card */}
        <div className="relative bg-[#09090b] text-white p-6 rounded-[28px] overflow-hidden flex flex-col justify-between min-h-[160px] shadow-lg transform transition duration-300 hover:scale-[1.02]">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-zinc-400 mb-1">Oct 12</p>
              <h4 className="font-semibold text-lg leading-tight">Absolute<br/>Success Deal</h4>
            </div>
            <button className="flex items-center justify-center size-8 rounded-full bg-white text-black hover:bg-zinc-200 transition">
              <ArrowUpRight className="size-4" />
            </button>
          </div>
          <div className="flex items-end justify-between mt-6">
            <span className="text-2xl font-bold tracking-tight">2,100$</span>
            <div className="flex -space-x-2">
              <Avatar className="size-8 border-2 border-black"><AvatarFallback className="bg-zinc-800 text-zinc-300 text-xs">K</AvatarFallback></Avatar>
              <Avatar className="size-8 border-2 border-black"><AvatarFallback className="bg-zinc-700 text-zinc-300 text-xs">L</AvatarFallback></Avatar>
              <Avatar className="size-8 border-2 border-black"><AvatarFallback className="bg-zinc-600 text-zinc-300 text-xs">M</AvatarFallback></Avatar>
            </div>
          </div>
        </div>
        
        {/* Light Gray Split Card (Bottom spans full width optionally, but let's just make it two sub cards inside a single block if we want to match exactly. Or just two more columns.) */}
        <div className="md:col-span-2 grid grid-cols-2 gap-4">
          <div className="bg-white/60 p-5 rounded-[24px] flex justify-between items-center shadow-sm">
             <div>
               <p className="text-xs font-medium text-slate-400 mb-1">Oct 2</p>
               <h5 className="font-semibold text-sm text-slate-700">Adaptive<br/>Business Services</h5>
               <p className="font-bold text-slate-800 mt-2">3,140$</p>
             </div>
             <div className="flex flex-col items-end gap-3 h-full justify-between">
                <button className="text-slate-400 hover:text-slate-600"><MoreHorizontal className="size-4" /></button>
                <div className="flex -space-x-2">
                  <Avatar className="size-6 border-2 border-white"><AvatarFallback className="text-[10px]">A</AvatarFallback></Avatar>
                  <Avatar className="size-6 border-2 border-white"><AvatarFallback className="text-[10px]">B</AvatarFallback></Avatar>
                  <Avatar className="size-6 border-2 border-white"><AvatarFallback className="text-[10px]">C</AvatarFallback></Avatar>
                </div>
             </div>
          </div>
          <div className="bg-white/60 p-5 rounded-[24px] flex justify-between items-center shadow-sm">
             <div>
               <p className="text-xs font-medium text-slate-400 mb-1">Oct 2</p>
               <h5 className="font-semibold text-sm text-slate-700">Second deal<br/>Common Service</h5>
               <p className="font-bold text-slate-800 mt-2">12,350$</p>
             </div>
             <div className="flex flex-col items-end gap-3 h-full justify-between">
                <button className="text-slate-400 hover:text-slate-600"><MoreHorizontal className="size-4" /></button>
                <div className="flex -space-x-2">
                  <Avatar className="size-6 border-2 border-white"><AvatarFallback className="text-[10px]">D</AvatarFallback></Avatar>
                  <Avatar className="size-6 border-2 border-white"><AvatarFallback className="text-[10px]">E</AvatarFallback></Avatar>
                  <Avatar className="size-6 border-2 border-white"><AvatarFallback className="text-[10px]">F</AvatarFallback></Avatar>
                </div>
             </div>
          </div>
        </div>
      </div>
    </div>
  )
}
