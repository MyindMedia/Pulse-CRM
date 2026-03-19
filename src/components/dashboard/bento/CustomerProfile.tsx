'use client'

import { MoreHorizontal, ArrowUpRight, Edit2, Mail, Phone, Plus, Calendar, FileText } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

export function CustomerProfile() {
  return (
    <div className="bg-gradient-to-br from-white/60 to-white/30 backdrop-blur-xl rounded-[40px] border border-white/60 p-6 flex flex-col items-center shadow-lg relative h-[340px]">
      <div className="w-full flex justify-between absolute top-6 left-0 px-6">
        <div className="flex items-center gap-2">
           <button className="flex items-center justify-center size-8 rounded-full border border-slate-200 bg-white/50 text-slate-500 hover:bg-slate-100 transition">
             <span className="w-1.5 h-1.5 rounded-full bg-red-400 mr-0.5"></span>
             <Share2Icon className="size-3" />
           </button>
        </div>
        <div className="flex items-center gap-2">
          <button className="flex items-center justify-center size-8 rounded-full border border-slate-200 bg-white/50 text-slate-500 hover:bg-slate-100 transition">
            <MoreHorizontal className="size-4" />
          </button>
          <button className="flex items-center justify-center size-8 rounded-full border border-slate-200 bg-white/50 text-slate-500 hover:bg-slate-100 transition">
            <ArrowUpRight className="size-4" />
          </button>
        </div>
      </div>

      <div className="mt-8 mb-4">
        <div className="size-24 rounded-full border-4 border-white shadow-xl overflow-hidden bg-slate-200 flex items-center justify-center">
            {/* Using a placeholder avatar color/gradient if no image */}
           <div className="w-full h-full bg-gradient-to-br from-indigo-300 to-purple-400"></div>
        </div>
      </div>

      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-slate-800">Eva Robinson</h2>
        <p className="text-sm text-slate-500 font-medium max-w-[200px] mt-1">CEO. Inc. Alabama Machinery & Supply</p>
      </div>

      <div className="flex items-center gap-3 w-full justify-center mt-auto mb-2">
        <button className="flex items-center justify-center size-10 rounded-full bg-white text-slate-600 shadow-sm border border-slate-100 hover:scale-105 transition"><Edit2 className="size-4" /></button>
        <button className="flex items-center justify-center size-10 rounded-full bg-white text-slate-600 shadow-sm border border-slate-100 hover:scale-105 transition"><Mail className="size-4" /></button>
        <button className="flex items-center justify-center size-10 rounded-full bg-white text-slate-600 shadow-sm border border-slate-100 hover:scale-105 transition"><Phone className="size-4" /></button>
        <button className="flex items-center justify-center size-10 rounded-full bg-white text-slate-600 shadow-sm border border-slate-100 hover:scale-105 transition"><Plus className="size-4" /></button>
        <button className="flex items-center justify-center size-10 rounded-full bg-white text-slate-600 shadow-sm border border-slate-100 hover:scale-105 transition"><Calendar className="size-4" /></button>
        <button className="flex items-center justify-center size-10 rounded-full bg-white text-slate-600 shadow-sm border border-slate-100 hover:scale-105 transition"><FileText className="size-4" /></button>
      </div>
    </div>
  )
}

function Share2Icon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" x2="15.42" y1="13.51" y2="17.49" />
      <line x1="15.41" x2="8.59" y1="6.51" y2="10.49" />
    </svg>
  )
}
