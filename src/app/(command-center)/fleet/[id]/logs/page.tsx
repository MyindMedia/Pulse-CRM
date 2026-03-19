import Link from 'next/link'
import { ArrowLeft, BookOpen, TerminalSquare, Settings, Download, Search, Filter } from 'lucide-react'

export default function AgentAPILogs() {
  return (
    <div className="flex flex-col gap-8 w-full min-h-full animate-in fade-in duration-500 pb-10">
      
      {/* Top Header & Overview Banner (Simplified) */}
      <div className="flex flex-col gap-6">
        <Link href="/fleet" className="flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-900 transition-colors w-fit">
           <ArrowLeft className="size-4" /> Back to Fleet
        </Link>
        <div className="flex items-center justify-between">
           <div className="flex items-center gap-4">
              <div className="size-12 rounded-full bg-slate-100 border-2 border-white shadow-sm flex items-center justify-center text-xl shrink-0">✉️</div>
              <div>
                 <h1 className="text-2xl font-bold text-slate-900 tracking-tight">EmailBot Beta</h1>
                 <p className="text-slate-500 font-medium text-sm">Live API Traces</p>
              </div>
           </div>
           <button className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-5 py-2.5 rounded-xl font-bold shadow-sm transition-all hover:-translate-y-0.5 w-fit">
              <Download className="size-4" /> Export Logs
           </button>
        </div>
      </div>

      {/* Tabs Layout */}
      <div className="flex flex-col gap-6">
         
         {/* Navigation Tabs */}
         <div className="flex items-center gap-2 border-b border-slate-200 overflow-x-auto pb-px">
            <Link href="/fleet/1" className="px-6 py-3 font-bold text-sm border-b-2 transition-colors whitespace-nowrap border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300">
               <span className="flex items-center gap-2"><Settings className="size-4" /> Activity Stream</span>
            </Link>
            <Link href="/fleet/1/skills" className="px-6 py-3 font-bold text-sm border-b-2 transition-colors whitespace-nowrap border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300">
               <span className="flex items-center gap-2"><BookOpen className="size-4" /> Skills & Prompts</span>
            </Link>
            <Link href="/fleet/1/logs" className="px-6 py-3 font-bold text-sm border-b-2 transition-colors whitespace-nowrap border-[#FACC15] text-[#FACC15]">
               <span className="flex items-center gap-2"><TerminalSquare className="size-4" /> Live API Logs</span>
            </Link>
            <Link href="#" className="px-6 py-3 font-bold text-sm border-b-2 transition-colors whitespace-nowrap border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300">
               <span className="flex items-center gap-2"><Settings className="size-4" /> Settings</span>
            </Link>
         </div>

         {/* Terminal View Content */}
         <div className="bg-slate-950 rounded-[24px] shadow-[0_30px_60px_-15px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col h-[600px] border border-slate-800">
            {/* Terminal Header */}
            <div className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
               <div className="flex gap-4 items-center">
                  <div className="flex gap-1.5">
                     <div className="size-3 rounded-full bg-slate-700"></div>
                     <div className="size-3 rounded-full bg-slate-700"></div>
                     <div className="size-3 rounded-full bg-slate-700"></div>
                  </div>
                  <div className="h-4 w-px bg-slate-700"></div>
                  <div className="flex gap-3">
                     <span className="text-xs font-mono text-emerald-400 flex items-center gap-1.5"><div className="size-2 rounded-full bg-emerald-500 animate-pulse"></div> Streaming Connected</span>
                  </div>
               </div>
               
               <div className="flex gap-2">
                  <div className="relative">
                     <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-500" />
                     <input type="text" placeholder="Filter grep..." className="w-48 pl-8 pr-3 py-1 bg-slate-800 border-none rounded text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-600 font-mono" />
                  </div>
                  <button className="p-1 px-2 border border-slate-700 bg-slate-800 rounded text-slate-400 hover:text-white transition-colors"><Filter className="size-3.5" /></button>
               </div>
            </div>

            {/* Terminal Output */}
            <div className="p-6 font-mono text-[13px] leading-relaxed overflow-y-auto flex-1 text-slate-300">
               <div className="mb-4">
                  <span className="text-slate-500">[2026-10-24T14:32:01.000Z]</span> <span className="text-yellow-400">INFO</span> <span className="text-slate-400">INIT:</span> <span className="text-slate-200">Starting task queue loop...</span>
               </div>
               <div className="mb-4">
                  <span className="text-slate-500">[2026-10-24T14:32:02.124Z]</span> <span className="text-purple-400">REQ</span> <span className="text-slate-400">POST https://api.openai.com/v1/chat/completions</span><br/>
                  <span className="text-slate-500">  model:</span> <span className="text-emerald-300">"gpt-4-turbo"</span><br/>
                  <span className="text-slate-500">  system_tokens:</span> <span className="text-amber-300">142</span><br/>
                  <span className="text-slate-500">  user_tokens:</span> <span className="text-amber-300">1408</span><br/>
                  <span className="text-slate-500">  payload snippet:</span> <span className="text-slate-400">{"{"} "role": "user", "content": "Draft outreach for Lead ID #9012. Company: AcmeCorp. Context..." {"}"}</span>
               </div>
               <div className="mb-4">
                  <span className="text-slate-500">[2026-10-24T14:32:05.802Z]</span> <span className="text-emerald-400">RES</span> <span className="text-slate-400">200 OK (3.67s)</span><br/>
                  <span className="text-slate-500">  completion_tokens:</span> <span className="text-amber-300">294</span><br/>
                  <span className="text-slate-500">  cost:</span> <span className="text-pink-400">$0.021</span><br/>
                  <span className="text-slate-500">  content snippet:</span> <span className="text-slate-400">"Hi Jordan,\n\nI noticed AcmeCorp recently expanded its Data division..."</span>
               </div>
               <div className="mb-4">
                  <span className="text-slate-500">[2026-10-24T14:32:06.100Z]</span> <span className="text-yellow-400">INFO</span> <span className="text-slate-400">SKILL_TRIGGER:</span> <span className="text-slate-200">Executing [email_send] plugin...</span>
               </div>
               <div className="mb-4">
                  <span className="text-slate-500">[2026-10-24T14:32:06.315Z]</span> <span className="text-purple-400">REQ</span> <span className="text-slate-400">POST https://api.sendgrid.com/v3/mail/send</span>
               </div>
               <div className="mb-4">
                  <span className="text-slate-500">[2026-10-24T14:32:06.502Z]</span> <span className="text-emerald-400">RES</span> <span className="text-slate-400">202 Accepted (0.18s)</span>
               </div>
               <div className="mb-4">
                  <span className="text-slate-500">[2026-10-24T14:32:06.550Z]</span> <span className="text-yellow-400">INFO</span> <span className="text-slate-400">TASK_COMPLETE:</span> <span className="text-emerald-400 border border-emerald-400/30 bg-emerald-400/10 px-1 rounded">Success</span> <span className="text-slate-200">Added to pipeline stage 'Proposal'.</span>
               </div>
               <div className="mb-4 animate-pulse">
                  <span className="text-slate-500">[2026-10-24T14:32:07.000Z]</span> <span className="text-slate-400">Awaiting next task from Orchestrator (Aria)...</span>
               </div>
            </div>

         </div>

      </div>
    </div>
  )
}
