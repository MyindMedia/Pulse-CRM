import Link from 'next/link'
import { MoreHorizontal, Plus, Mail, Phone, Calendar as CalendarIcon, Edit2, Play, Pause, Activity } from 'lucide-react'

export default function DashboardOverview() {
  return (
    <div className="flex flex-col gap-6 w-full h-full animate-in fade-in duration-500">
      
      {/* Top Row: Title & Metrics */}
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Agentic Command Center</h1>
          <p className="text-slate-500 mt-1">Fleet overview and live orchestration status.</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3 bg-white px-5 py-3 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100">
            <div className="size-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">$</div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Budget</p>
              <p className="text-lg font-bold text-slate-900">$1,980,130 <span className="text-xs font-medium text-emerald-500 ml-1">+11% this week</span></p>
            </div>
          </div>
          <div className="flex items-center gap-3 bg-white px-5 py-3 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100">
            <div className="size-10 rounded-full bg-yellow-50 text-[#FACC15] flex items-center justify-center"><Activity className="size-5" /></div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active Agents</p>
              <p className="text-lg font-bold text-slate-900">89 <span className="text-xs font-medium text-[#FACC15] ml-1">+12 today</span></p>
            </div>
          </div>
          <div className="flex items-center gap-3 bg-white px-5 py-3 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100">
            <div className="size-10 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center font-bold">✓</div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Tasks</p>
              <p className="text-lg font-bold text-slate-900">31 <span className="text-xs font-medium text-purple-500 ml-1">+6 today</span></p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Recent Activity (Spans 8 cols) */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          <div className="bg-white rounded-3xl p-6 shadow-[0_20px_40px_-10px_rgba(30,41,59,0.06)] border border-slate-100">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-slate-900">Recent Agent Activity</h2>
              <button className="text-sm font-semibold text-[#FACC15] hover:text-[#EAB308]">View All Logs</button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Blue Card 1 */}
              <div className="bg-[#FACC15] text-slate-900 p-5 rounded-2xl shadow-md flex flex-col gap-4">
                <div className="flex justify-between items-start">
                  <span className="text-xs font-semibold bg-white/20 px-2 py-1 rounded-md">Oct 24, 10:42 AM</span>
                  <span className="text-sm font-bold bg-black/20 px-2.5 py-1 rounded-full">-$12.50</span>
                </div>
                <div>
                  <h3 className="font-bold text-lg leading-tight">Generate Q3 Marketing Report</h3>
                  <p className="text-yellow-100 text-sm mt-1 line-clamp-2">Compiled analytics from 4 sources and generated a 12-page summary presentation.</p>
                </div>
                <div className="flex -space-x-2 mt-auto pt-2">
                   <div className="size-8 rounded-full bg-gradient-to-tr from-pink-400 to-orange-400 border-2 border-[#FACC15]" />
                   <div className="size-8 rounded-full bg-gradient-to-tr from-cyan-400 to-yellow-400 border-2 border-[#FACC15]" />
                </div>
              </div>

              {/* Blue Card 2 */}
              <div className="bg-[#FACC15] text-slate-900 p-5 rounded-2xl shadow-md flex flex-col gap-4">
                <div className="flex justify-between items-start">
                  <span className="text-xs font-semibold bg-white/20 px-2 py-1 rounded-md">Oct 24, 09:15 AM</span>
                  <span className="text-sm font-bold bg-black/20 px-2.5 py-1 rounded-full">-$4.20</span>
                </div>
                <div>
                  <h3 className="font-bold text-lg leading-tight">Optimize React Frontend</h3>
                  <p className="text-yellow-100 text-sm mt-1 line-clamp-2">Refactored 3 components to prioritize Server Components, saving 140kb bundle size.</p>
                </div>
                <div className="flex -space-x-2 mt-auto pt-2">
                   <div className="size-8 rounded-full bg-gradient-to-tr from-emerald-400 to-teal-400 border-2 border-[#FACC15]" />
                </div>
              </div>

              {/* Yellow Card 1 */}
              <div className="bg-yellow-400 text-yellow-950 p-5 rounded-2xl shadow-md flex flex-col gap-4">
                <div className="flex justify-between items-start">
                  <span className="text-xs font-semibold bg-yellow-900/10 px-2 py-1 rounded-md">Oct 23, 04:30 PM</span>
                  <span className="text-sm font-bold bg-yellow-500/30 px-2.5 py-1 rounded-full">-$8.90</span>
                </div>
                <div>
                  <h3 className="font-bold text-lg leading-tight">Qualification Triage</h3>
                  <p className="text-yellow-800 text-sm mt-1 line-clamp-2">Processed 150 incoming leads. Assigned 42 to the high-priority pipeline.</p>
                </div>
                <div className="flex -space-x-2 mt-auto pt-2">
                   <div className="size-8 rounded-full bg-gradient-to-tr from-purple-400 to-indigo-400 border-2 border-yellow-400" />
                </div>
              </div>

              {/* Yellow Card 2 */}
              <div className="bg-yellow-400 text-yellow-950 p-5 rounded-2xl shadow-md flex flex-col gap-4">
                <div className="flex justify-between items-start">
                  <span className="text-xs font-semibold bg-yellow-900/10 px-2 py-1 rounded-md">In Progress</span>
                  <span className="text-sm font-bold bg-yellow-500/30 px-2.5 py-1 rounded-full group-hover:animate-pulse">Active</span>
                </div>
                <div>
                  <h3 className="font-bold text-lg leading-tight">Database Indexing</h3>
                  <p className="text-yellow-800 text-sm mt-1 line-clamp-2">Currently optimizing Postgres queries across 5 main tables.</p>
                </div>
                <div className="flex -space-x-2 mt-auto pt-2">
                   <div className="size-8 rounded-full bg-slate-800 border-2 border-yellow-400 flex items-center justify-center text-xs">⚙️</div>
                </div>
              </div>

              {/* Black Card */}
              <div className="bg-slate-900 text-slate-100 p-5 rounded-2xl shadow-md flex flex-col gap-4">
                <div className="flex justify-between items-start">
                  <span className="text-xs font-semibold bg-white/10 px-2 py-1 rounded-md">Oct 23, 01:10 PM</span>
                  <span className="text-sm font-bold bg-red-500/20 text-red-300 px-2.5 py-1 rounded-full">Failed</span>
                </div>
                <div>
                  <h3 className="font-bold text-lg leading-tight text-white">API Rate Limit Exceeded</h3>
                  <p className="text-slate-400 text-sm mt-1 line-clamp-2">Anthropic API rejected request (429). Attempted 3 retries with backoff.</p>
                </div>
                <div className="flex mt-auto pt-2">
                   <button className="text-xs font-bold text-white bg-white/10 px-3 py-1.5 rounded-lg hover:bg-white/20">View Trace</button>
                </div>
              </div>

              {/* White Card */}
              <div className="bg-slate-50 border border-slate-200 text-slate-800 p-5 rounded-2xl shadow-sm flex flex-col gap-4 hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start">
                  <span className="text-xs font-semibold bg-white border border-slate-200 px-2 py-1 rounded-md">Oct 23, 11:00 AM</span>
                  <span className="text-sm font-bold bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-full">-$1.10</span>
                </div>
                <div>
                  <h3 className="font-bold text-lg leading-tight">Drafted Client Emails</h3>
                  <p className="text-slate-500 text-sm mt-1 line-clamp-2">Generated 12 personalized outreach emails based on LinkedIn profiles.</p>
                </div>
                <div className="flex -space-x-2 mt-auto pt-2">
                   <div className="size-8 rounded-full bg-gradient-to-tr from-amber-200 to-yellow-400 border-2 border-white" />
                </div>
              </div>

            </div>
          </div>

          {/* Bottom Row inside left column: Schedule + Funnel */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Calendar */}
            <div className="bg-white rounded-3xl p-6 shadow-[0_20px_40px_-10px_rgba(30,41,59,0.06)] border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900 mb-4">Task Schedule</h2>
              <div className="rounded-2xl border border-slate-100 overflow-hidden text-sm">
                <div className="bg-slate-50 p-3 font-semibold text-center border-b border-slate-100">October 2026</div>
                <div className="grid grid-cols-7 gap-1 p-2 text-center text-slate-500">
                  {['S','M','T','W','T','F','S'].map(d => <div key={d} className="py-1 font-medium">{d}</div>)}
                  {Array.from({length: 31}).map((_, i) => {
                    const day = i + 1;
                    const isHighlighted = [14, 18, 24, 28].includes(day);
                    return (
                      <div key={day} className={`py-1.5 rounded-lg ${isHighlighted ? 'bg-[#FACC15] text-slate-900 font-bold shadow-sm' : 'hover:bg-slate-100 cursor-pointer'}`}>
                        {day}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Stage Funnel Placeholder */}
            <div className="bg-white rounded-3xl p-6 shadow-[0_20px_40px_-10px_rgba(30,41,59,0.06)] border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900 mb-4">Pipeline Value</h2>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-sm"><span className="font-semibold text-slate-700">Qualification</span><span className="font-bold text-slate-900">$92,350</span></div>
                  <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-yellow-200 w-[100%] rounded-full"></div></div>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-sm"><span className="font-semibold text-slate-700">Proposal</span><span className="font-bold text-slate-900">$67,120</span></div>
                  <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-yellow-400 w-[75%] rounded-full"></div></div>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between text-sm"><span className="font-semibold text-slate-700">Value Proposition</span><span className="font-bold text-slate-900">$28,980</span></div>
                  <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-[#FACC15] w-[45%] rounded-full"></div></div>
                </div>
                <div className="flex flex-col gap-1 mt-2 p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                  <div className="flex justify-between text-sm"><span className="font-bold text-emerald-800">Closed Won</span><span className="font-bold text-emerald-600">$350,500</span></div>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Right Column: Lead Advisor Profile (Spans 4 cols) */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          <div className="bg-white rounded-3xl p-6 shadow-[0_20px_40px_-10px_rgba(30,41,59,0.06)] border border-slate-100 flex-1 flex flex-col">
            <div className="flex justify-between items-start w-full">
              <div className="px-3 py-1 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-full flex items-center gap-1.5">
                <div className="size-1.5 bg-emerald-500 rounded-full animate-pulse"></div> Healthy
              </div>
              <button className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400"><MoreHorizontal className="size-5" /></button>
            </div>

            <div className="flex flex-col items-center mt-2 mb-6 text-center">
              <div className="size-28 rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 p-1 mb-4 shadow-lg">
                <div className="w-full h-full bg-white rounded-full border-4 border-white flex items-center justify-center overflow-hidden">
                   <span className="text-4xl">👑</span>
                </div>
              </div>
              <h2 className="text-2xl font-bold text-slate-900">Aria</h2>
              <p className="text-[#FACC15] font-semibold text-sm">Lead Orchestrator</p>
            </div>

            <div className="flex justify-center gap-2 mb-8">
              <button className="flex items-center justify-center size-10 rounded-full bg-slate-50 border border-slate-200 text-slate-600 hover:bg-yellow-50 hover:text-[#FACC15] hover:border-yellow-200 transition-all"><Edit2 className="size-4" /></button>
              <button className="flex items-center justify-center size-10 rounded-full bg-slate-50 border border-slate-200 text-slate-600 hover:bg-yellow-50 hover:text-[#FACC15] hover:border-yellow-200 transition-all"><Mail className="size-4" /></button>
              <button className="flex items-center justify-center size-10 rounded-full bg-slate-50 border border-slate-200 text-slate-600 hover:bg-yellow-50 hover:text-[#FACC15] hover:border-yellow-200 transition-all"><Phone className="size-4" /></button>
              <button className="flex items-center justify-center size-10 rounded-full bg-slate-50 border border-slate-200 text-slate-600 hover:bg-yellow-50 hover:text-[#FACC15] hover:border-yellow-200 transition-all"><CalendarIcon className="size-4" /></button>
              <button className="flex items-center justify-center size-10 rounded-full bg-[#FACC15] text-slate-900 hover:bg-[#EAB308] shadow-md transition-all"><Plus className="size-5" /></button>
            </div>

            <div className="bg-slate-50 rounded-2xl border border-slate-100 p-4 flex flex-col gap-4 mt-auto">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Detailed Information</h3>
              
              <div className="flex justify-between items-center text-sm py-2 border-b border-slate-200/60">
                <span className="text-slate-500 font-medium">System Status</span>
                <span className="font-semibold text-emerald-600">Online & Active</span>
              </div>
              <div className="flex justify-between items-center text-sm py-2 border-b border-slate-200/60">
                <span className="text-slate-500 font-medium">Managed Budget</span>
                <div className="text-right">
                   <div className="font-semibold text-slate-900">$840,000</div>
                   <div className="text-xs text-slate-400">42% of total</div>
                </div>
              </div>
              <div className="flex justify-between items-center text-sm py-2 border-b border-slate-200/60">
                <span className="text-slate-500 font-medium">Connected APIs</span>
                <span className="font-semibold text-slate-900">4 Integrations</span>
              </div>
              <div className="flex justify-between items-center text-sm py-2">
                <span className="text-slate-500 font-medium">Last Active</span>
                <span className="font-semibold text-slate-900">Just now</span>
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  )
}
