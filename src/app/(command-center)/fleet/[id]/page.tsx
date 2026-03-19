import Link from 'next/link'
import { ArrowLeft, Play, Settings, BookOpen, TerminalSquare, RefreshCw, BarChart2 } from 'lucide-react'

export default function AgentDetailView() {
  return (
    <div className="flex flex-col gap-8 w-full min-h-full animate-in fade-in duration-500 pb-10">
      
      {/* Top Header & Overview Banner */}
      <div className="flex flex-col gap-6">
        <Link href="/fleet" className="flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-900 transition-colors w-fit">
           <ArrowLeft className="size-4" /> Back to Fleet
        </Link>
        
        <div className="bg-white rounded-[32px] p-8 md:p-10 shadow-[0_20px_40px_-10px_rgba(30,41,59,0.06)] border border-slate-100 flex flex-col xl:flex-row gap-8 items-start xl:items-center justify-between">
           
           <div className="flex items-center gap-6">
              <div className="size-20 md:size-24 rounded-full bg-slate-100 border-4 border-white shadow-xl flex items-center justify-center text-4xl shrink-0">
                 ✉️
              </div>
              <div>
                 <div className="flex items-center gap-3 mb-1">
                    <h1 className="text-3xl font-bold text-slate-900 tracking-tight">EmailBot Beta</h1>
                    <span className="px-3 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-full border border-emerald-200 uppercase tracking-wider flex items-center gap-1.5"><div className="size-1.5 rounded-full bg-emerald-500"></div> Active</span>
                 </div>
                 <p className="text-slate-500 font-medium text-lg">Support Representative • Managed by Aria</p>
              </div>
           </div>

           <div className="flex flex-col sm:flex-row gap-4 sm:gap-8 xl:pr-4 w-full xl:w-auto overflow-x-auto pb-4 xl:pb-0">
              <div className="flex flex-col shrink-0">
                 <span className="text-slate-400 font-bold uppercase tracking-wider text-xs mb-1">Total Tasks</span>
                 <span className="text-3xl font-black text-slate-900">14,204</span>
              </div>
              <div className="w-px h-12 bg-slate-200 hidden sm:block self-center shrink-0"></div>
              <div className="flex flex-col shrink-0">
                 <span className="text-slate-400 font-bold uppercase tracking-wider text-xs mb-1">Success Rate</span>
                 <span className="text-3xl font-black text-emerald-600">98.2%</span>
              </div>
              <div className="w-px h-12 bg-slate-200 hidden sm:block self-center shrink-0"></div>
              <div className="flex flex-col shrink-0">
                 <span className="text-slate-400 font-bold uppercase tracking-wider text-xs mb-1">Cost to Date</span>
                 <span className="text-3xl font-black text-slate-900">$340.50</span>
              </div>
           </div>
        </div>
      </div>

      {/* Tabs Layout */}
      <div className="flex flex-col gap-6">
         
         {/* Navigation Tabs */}
         <div className="flex items-center gap-2 border-b border-slate-200 overflow-x-auto pb-px">
            <Link href="/fleet/1" className="px-6 py-3 font-bold text-sm border-b-2 transition-colors whitespace-nowrap border-[#FACC15] text-[#FACC15]">
               <span className="flex items-center gap-2"><BarChart2 className="size-4" /> Activity Stream</span>
            </Link>
            <Link href="/fleet/1/skills" className="px-6 py-3 font-bold text-sm border-b-2 transition-colors whitespace-nowrap border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300">
               <span className="flex items-center gap-2"><BookOpen className="size-4" /> Skills & Prompts</span>
            </Link>
            <Link href="/fleet/1/logs" className="px-6 py-3 font-bold text-sm border-b-2 transition-colors whitespace-nowrap border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300">
               <span className="flex items-center gap-2"><TerminalSquare className="size-4" /> Live API Logs</span>
            </Link>
            <Link href="#" className="px-6 py-3 font-bold text-sm border-b-2 transition-colors whitespace-nowrap border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300">
               <span className="flex items-center gap-2"><Settings className="size-4" /> Settings</span>
            </Link>
         </div>

         {/* Activity Stream Content */}
         <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Left Col: Current Task & Queue */}
            <div className="lg:col-span-1 flex flex-col gap-6">
               <div className="bg-white rounded-3xl shadow-[0_20px_40px_-10px_rgba(30,41,59,0.06)] border border-slate-100 p-6 flex flex-col">
                  <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4 border-b border-slate-100 pb-2">Current Execution</h2>
                  <div className="flex items-start gap-4 p-4 bg-yellow-50/50 border border-yellow-100 rounded-xl mb-4">
                     <Play className="size-5 text-[#FACC15] shrink-0 mt-0.5" />
                     <div>
                        <p className="font-bold text-yellow-900 mb-1 leading-tight">Drafting responses for "Enterprise Trial Inquiry" queue</p>
                        <p className="text-xs text-[#EAB308]/70 font-mono">Running for 42s... (Batches 24/50 completed)</p>
                     </div>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden mb-6">
                     <div className="bg-[#FACC15] h-full w-[48%] rounded-full relative overflow-hidden">
                        <div className="absolute inset-0 bg-white/20 w-4 transform skew-x-12 animate-[shimmer_2s_infinite]"></div>
                     </div>
                  </div>

                  <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4 border-b border-slate-100 pb-2 flex items-center justify-between">
                     <span>Task Queue</span>
                     <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">3 Pending</span>
                  </h2>
                  <div className="flex flex-col gap-3">
                     <div className="flex items-center justify-between p-3 border border-slate-200 border-l-4 border-l-slate-300 rounded-lg hover:bg-slate-50">
                        <span className="text-sm font-semibold text-slate-700 truncate w-[180px]">Follow-up inactive leads</span>
                        <span className="text-xs text-slate-400 font-mono">14s est.</span>
                     </div>
                     <div className="flex items-center justify-between p-3 border border-slate-200 border-l-4 border-l-slate-300 rounded-lg hover:bg-slate-50">
                        <span className="text-sm font-semibold text-slate-700 truncate w-[180px]">Categorize Spam folder</span>
                        <span className="text-xs text-slate-400 font-mono">5s est.</span>
                     </div>
                     <div className="flex items-center justify-between p-3 border border-slate-200 border-l-4 border-l-slate-300 rounded-lg hover:bg-slate-50 opacity-60">
                        <span className="text-sm font-semibold text-slate-700 truncate w-[180px]">Sync Hubspot contacts</span>
                        <span className="text-xs text-slate-400 font-mono">Scheduled</span>
                     </div>
                  </div>
               </div>
            </div>

            {/* Right Col: Timeline */}
            <div className="lg:col-span-2 bg-white rounded-3xl shadow-[0_20px_40px_-10px_rgba(30,41,59,0.06)] border border-slate-100 p-8 flex flex-col">
               <div className="flex items-center justify-between mb-8 pb-4 border-b border-slate-100">
                  <h2 className="text-lg font-bold text-slate-900">Recent Activity Stream</h2>
                  <button className="flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition-colors border border-slate-200">
                     <RefreshCw className="size-3.5" /> Refresh
                  </button>
               </div>

               <div className="relative border-l-2 border-slate-100 ml-4 pl-8 flex flex-col gap-8 pb-4">
                  {/* Event 1 */}
                  <div className="relative">
                     <div className="absolute -left-[41px] top-1 size-5 rounded-full border-2 border-white bg-[#FACC15] ring-4 ring-yellow-50"></div>
                     <div className="flex flex-col gap-1">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Today, 10:14 AM</span>
                        <h3 className="text-base font-bold text-slate-900">Completed Email Batch "Q3 Partner Updates"</h3>
                        <p className="text-sm text-slate-600">Successfully drafted and scheduled 142 personalized emails. Average processing time 1.2s per recipient.</p>
                        <div className="mt-2 text-xs font-mono font-bold text-slate-500 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 w-fit">Cost: $0.14 | Tokens: 4,021</div>
                     </div>
                  </div>
                  
                  {/* Event 2 */}
                  <div className="relative">
                     <div className="absolute -left-[41px] top-1 size-5 rounded-full border-2 border-white bg-purple-500 ring-4 ring-purple-50"></div>
                     <div className="flex flex-col gap-1">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Today, 09:30 AM</span>
                        <h3 className="text-base font-bold text-slate-900">Advisor Override: Pause execution</h3>
                        <p className="text-sm text-slate-600">Aria halted the "Cold Outreach list 3" queue due to low engagement scores detected across the fleet.</p>
                     </div>
                  </div>

                  {/* Event 3 */}
                  <div className="relative">
                     <div className="absolute -left-[41px] top-1 size-5 rounded-full border-2 border-white bg-emerald-500 ring-4 ring-emerald-50"></div>
                     <div className="flex flex-col gap-1">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Yesterday, 04:15 PM</span>
                        <h3 className="text-base font-bold text-slate-900">Routine Check & Retrain</h3>
                        <p className="text-sm text-slate-600">Automatically flushed vector DB context and loaded new FAQ parameters via vector search indexing.</p>
                     </div>
                  </div>
               </div>

            </div>

         </div>

      </div>
    </div>
  )
}
