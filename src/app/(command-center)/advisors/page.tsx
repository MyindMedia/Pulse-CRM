import Link from 'next/link'
import { Plus, Search, Filter, MoreVertical, Activity, Users, Settings } from 'lucide-react'

const advisors = [
  { id: 'aria', name: 'Aria', role: 'Lead Orchestrator', health: 'Healthy', managed: '$840,000', avatar: '👑', active: true },
  { id: 'neo', name: 'Neo', role: 'Chief Marketing Officer', health: 'Warning', managed: '$320,000', avatar: '📈', active: false },
  { id: 'atlas', name: 'Atlas', role: 'Data Operations Lead', health: 'Healthy', managed: '$450,000', avatar: '📊', active: false },
  { id: 'echo', name: 'Echo', role: 'Customer Success Dir.', health: 'Critical', managed: '$120,500', avatar: '🎧', active: false },
]

export default function AdvisorCommandCenter() {
  return (
    <div className="flex flex-col gap-6 w-full h-[calc(100vh-120px)] animate-in fade-in duration-500 pb-6">
      
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Advisor Command Center</h1>
          <p className="text-slate-500 mt-1">Manage the top-level AI strategists overseeing your operational fleets.</p>
        </div>
        <button className="flex items-center gap-2 bg-[#FACC15] hover:bg-[#EAB308] text-slate-900 px-5 py-2.5 rounded-xl font-bold shadow-[0_8px_16px_-4px_rgba(37,99,235,0.4)] transition-all hover:-translate-y-0.5">
          <Plus className="size-5" /> Hire New Advisor
        </button>
      </div>

      {/* Main Split View */}
      <div className="flex flex-col lg:flex-row gap-6 min-h-0 flex-1">
        
        {/* Left Pane: Advisor List */}
        <div className="w-full lg:w-1/3 bg-white rounded-3xl shadow-[0_20px_40px_-10px_rgba(30,41,59,0.06)] border border-slate-100 flex flex-col overflow-hidden">
          <div className="p-5 border-b border-slate-100 shrink-0 space-y-4">
            <h2 className="text-lg font-bold text-slate-900">Active Advisors <span className="text-slate-400 font-medium ml-2 font-mono text-sm">(4)</span></h2>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
                <input type="text" placeholder="Search advisors..." className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#FACC15]/20 focus:border-[#FACC15] transition-colors" />
              </div>
              <button className="p-2 border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 transition-colors"><Filter className="size-4" /></button>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {advisors.map((adv) => (
              <Link key={adv.id} href={`/advisors/${adv.id}`} className={`flex items-center gap-4 p-4 rounded-xl border transition-all cursor-pointer ${adv.active ? 'bg-yellow-50/50 border-yellow-200 shadow-sm' : 'bg-white border-transparent hover:bg-slate-50 hover:border-slate-200'}`}>
                <div className="size-12 rounded-full bg-slate-100 flex items-center justify-center text-2xl border-2 border-white shadow-sm shrink-0">
                  {adv.avatar}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center mb-1">
                    <h3 className="font-bold text-slate-900 truncate">{adv.name}</h3>
                    <div className="flex items-center gap-1.5">
                       <span className={`size-2 rounded-full ${adv.health === 'Healthy' ? 'bg-emerald-500' : adv.health === 'Warning' ? 'bg-yellow-400' : 'bg-red-500'}`}></span>
                       <span className="text-xs font-semibold text-slate-500">{adv.health}</span>
                    </div>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500 truncate">{adv.role}</span>
                    <span className="font-bold text-slate-700 font-mono">{adv.managed}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Right Pane: Details for Selected Advisor */}
        <div className="w-full lg:w-2/3 bg-white rounded-3xl shadow-[0_20px_40px_-10px_rgba(30,41,59,0.06)] border border-slate-100 flex flex-col overflow-hidden">
          {/* Header area of details pane */}
          <div className="p-6 md:p-8 border-b border-slate-100 shrink-0 bg-gradient-to-br from-slate-50 to-white flex items-end justify-between">
            <div className="flex items-center gap-6">
              <div className="size-20 md:size-24 rounded-full bg-gradient-to-br from-indigo-500 to-pink-500 p-1 shadow-lg">
                <div className="w-full h-full bg-white rounded-full border-4 border-white flex items-center justify-center text-4xl">👑</div>
              </div>
              <div>
                <div className="flex items-center gap-3 mb-1">
                   <h2 className="text-3xl font-bold text-slate-900">Aria</h2>
                   <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-full border border-emerald-200">Online</span>
                </div>
                <p className="text-slate-500 font-medium text-lg">Lead Orchestrator</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Link href="/advisors/aria" className="text-sm px-4 py-2 bg-white border border-slate-200 text-slate-700 font-bold rounded-lg shadow-sm hover:bg-slate-50 transition-colors">
                 Full Profile
              </Link>
              <button className="p-2 border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 transition-colors bg-white shadow-sm"><Settings className="size-4" /></button>
            </div>
          </div>

          {/* Details Content Layout */}
          <div className="flex-1 overflow-y-auto p-6 md:p-8 grid grid-cols-1 xl:grid-cols-2 gap-8">
            
            {/* Subordinates Org Chart (Simplified list for now) */}
            <div className="flex flex-col gap-4">
               <div className="flex items-center gap-2 mb-2">
                 <Users className="size-5 text-[#FACC15]" />
                 <h3 className="text-lg font-bold text-slate-900">Fleet Hierarchy</h3>
               </div>
               <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5 relative">
                  {/* Decorative line connecting nodes */}
                  <div className="absolute left-9 top-10 bottom-10 w-0.5 bg-slate-200"></div>
                  
                  <div className="relative z-10 flex flex-col gap-5">
                    {/* Top Node */}
                    <div className="flex items-center gap-4 bg-white p-3 rounded-xl border border-slate-200 shadow-sm w-full">
                       <div className="size-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-lg shadow-inner">👑</div>
                       <div><p className="font-bold text-sm text-slate-900">Aria</p><p className="text-xs text-slate-500">Master Orchestrator</p></div>
                    </div>
                    
                    {/* Sub Nodes */}
                    <div className="flex items-center gap-4 bg-white p-3 rounded-xl border border-slate-200 shadow-sm w-[90%] ml-auto">
                       <div className="size-10 rounded-full bg-yellow-100 text-[#FACC15] flex items-center justify-center text-lg shadow-inner">✉️</div>
                       <div><p className="font-bold text-sm text-slate-900">EmailBot Beta</p><p className="text-xs text-slate-500">Outreach Execution</p></div>
                    </div>

                    <div className="flex items-center gap-4 bg-white p-3 rounded-xl border border-slate-200 shadow-sm w-[90%] ml-auto">
                       <div className="size-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center text-lg shadow-inner">📊</div>
                       <div><p className="font-bold text-sm text-slate-900">DataCruncher v2</p><p className="text-xs text-slate-500">Analytics Parsing</p></div>
                    </div>

                    <div className="flex items-center gap-4 bg-white p-3 rounded-xl border border-slate-200 shadow-sm w-[90%] ml-auto">
                       <div className="size-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center text-lg shadow-inner">💬</div>
                       <div><p className="font-bold text-sm text-slate-900">Support Helper</p><p className="text-xs text-slate-500">Ticket Triage</p></div>
                    </div>
                  </div>
               </div>
            </div>

            {/* Recent Directives Feed */}
            <div className="flex flex-col gap-4">
               <div className="flex items-center gap-2 mb-2">
                 <Activity className="size-5 text-[#FACC15]" />
                 <h3 className="text-lg font-bold text-slate-900">Recent Directives</h3>
               </div>
               
               <div className="flex flex-col gap-4">
                 <div className="border-l-2 border-yellow-500 pl-4 py-1">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">10 Min Ago</p>
                    <p className="text-sm font-semibold text-slate-900 mb-1">Reassigned $400 budget to Content Generators</p>
                    <p className="text-xs text-slate-500">Shifted funds due to high demand in Q4 marketing push.</p>
                 </div>
                 <div className="border-l-2 border-slate-200 pl-4 py-1">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">1 Hour Ago</p>
                    <p className="text-sm font-semibold text-slate-900 mb-1">Instructed Fleet to pause outbound emails</p>
                    <p className="text-xs text-slate-500">Detected deliverability spike. Paused campaign for manual review.</p>
                 </div>
                 <div className="border-l-2 border-slate-200 pl-4 py-1">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Yesterday</p>
                    <p className="text-sm font-semibold text-slate-900 mb-1">Deployed new scraping protocol to DataCruncher</p>
                    <p className="text-xs text-slate-500">Updated targeting parameters for lead generation.</p>
                 </div>
               </div>
               
               <button className="mt-auto py-2 w-full border border-slate-200 rounded-lg text-sm font-bold text-[#FACC15] bg-slate-50 hover:bg-yellow-50 hover:border-yellow-200 transition-colors">
                  View Full Audit Log
               </button>
            </div>

          </div>
        </div>

      </div>
    </div>
  )
}
