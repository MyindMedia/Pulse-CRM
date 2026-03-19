'use client'

import { MoreHorizontal, ArrowUpRight } from 'lucide-react'

export function DetailedInformation() {
  return (
    <div className="bg-white/40 backdrop-blur-xl rounded-[40px] border border-white/60 p-6 flex flex-col shadow-sm flex-1">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-semibold text-slate-800">Detailed Information</h3>
        <div className="flex items-center justify-center size-8 rounded-full border border-slate-200 bg-white/50 text-slate-500 hover:bg-slate-100 transition">
          <MoreHorizontal className="size-4" />
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <div className="flex justify-between items-center border-b border-white/40 pb-3">
          <span className="text-slate-500 font-medium">Title</span>
          <span className="text-slate-800 font-semibold">Chief Executive Officer</span>
        </div>
        <div className="flex justify-between items-center border-b border-white/40 pb-3">
          <span className="text-slate-500 font-medium">Type Deals</span>
          <span className="text-slate-800 font-semibold">New Business</span>
        </div>
        <div className="flex justify-between items-center border-b border-white/40 pb-3">
          <span className="text-slate-500 font-medium">Email</span>
          <span className="text-slate-800 font-semibold underline decoration-slate-300 underline-offset-4">eva.robinson@company.com</span>
        </div>
        <div className="flex justify-between items-center border-b border-white/40 pb-3">
          <span className="text-slate-500 font-medium">Phone</span>
          <span className="text-slate-800 font-semibold underline decoration-slate-300 underline-offset-4">+1 (555) 019-2831</span>
        </div>
        <div className="flex justify-between items-center border-b border-white/40 pb-3">
          <span className="text-slate-500 font-medium">Stage</span>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#FEFCE8]0"></span>
            <span className="text-slate-800 font-semibold">Royal Package Opportunity</span>
          </div>
        </div>
        <div className="flex justify-between items-center pb-1">
          <span className="text-slate-500 font-medium">Lead Source</span>
          <span className="text-slate-800 font-semibold">Referral</span>
        </div>
      </div>
    </div>
  )
}
