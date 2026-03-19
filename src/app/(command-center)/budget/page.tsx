import { AlertOctagon, TrendingUp, SlidersHorizontal, Download } from 'lucide-react'

export default function BudgetAndCostControls() {
  return (
    <div className="flex flex-col gap-8 w-full min-h-full animate-in fade-in duration-500 pb-10">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Budget & Cost Controls</h1>
          <p className="text-slate-500 mt-1">Manage API spending limits, monitor consumption, and control fleet resources.</p>
        </div>
        <button className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-xl font-bold shadow-[0_8px_16px_-4px_rgba(220,38,38,0.4)] transition-all hover:shadow-[0_8px_20px_-4px_rgba(220,38,38,0.6)] hover:-translate-y-0.5">
          <AlertOctagon className="size-5" /> Pause All Orchestration
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Top Metric Cards */}
        <div className="bg-white p-6 rounded-3xl shadow-[0_20px_40px_-10px_rgba(30,41,59,0.06)] border border-slate-100 flex flex-col justify-between hidden-overflow relative">
           <div className="absolute right-0 top-0 p-6 opacity-10">
              <TrendingUp className="size-24 text-[#FACC15]" />
           </div>
           <div>
             <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-2">Month to Date Spend</h3>
             <p className="text-4xl font-black text-slate-900">$18,450.20</p>
           </div>
           <div className="mt-6 flex items-center gap-2 text-sm font-bold text-emerald-600 bg-emerald-50 w-fit px-3 py-1 rounded-lg">
             ↓ 12% under projected
           </div>
        </div>

        <div className="bg-white p-6 rounded-3xl shadow-[0_20px_40px_-10px_rgba(30,41,59,0.06)] border border-slate-100 flex flex-col justify-between">
           <div>
             <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-2">Daily Run Rate</h3>
             <p className="text-4xl font-black text-slate-900">$640.00</p>
           </div>
           <div className="mt-6 flex items-center gap-2 text-sm font-bold text-slate-600 bg-slate-100 w-fit px-3 py-1 rounded-lg border border-slate-200">
             Target limit: $1,000/day
           </div>
        </div>

        <div className="bg-white p-6 rounded-3xl shadow-[0_20px_40px_-10px_rgba(30,41,59,0.06)] border border-slate-100 flex flex-col justify-between">
           <div>
             <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">API Provider Distribution</h3>
             <div className="flex w-full h-4 rounded-full overflow-hidden mb-2">
                <div className="h-full bg-emerald-500 w-[60%]" title="OpenAI"></div>
                <div className="h-full bg-purple-500 w-[30%]" title="Anthropic"></div>
                <div className="h-full bg-yellow-500 w-[10%]" title="Google"></div>
             </div>
           </div>
           <div className="flex gap-4 text-xs font-bold text-slate-500 mt-4">
             <div className="flex items-center gap-1.5"><div className="size-2.5 rounded-sm bg-emerald-500"></div> OpenAI</div>
             <div className="flex items-center gap-1.5"><div className="size-2.5 rounded-sm bg-purple-500"></div> Anthropic</div>
             <div className="flex items-center gap-1.5"><div className="size-2.5 rounded-sm bg-yellow-500"></div> Google</div>
           </div>
        </div>

        {/* Sliders Area */}
        <div className="lg:col-span-2 bg-white rounded-[32px] shadow-[0_20px_40px_-10px_rgba(30,41,59,0.06)] border border-slate-100 p-8">
           <div className="flex items-center gap-2 mb-8 border-b border-slate-100 pb-4">
              <SlidersHorizontal className="size-6 text-[#FACC15]" />
              <h2 className="text-xl font-bold text-slate-900">Department Limits</h2>
           </div>

           <div className="flex flex-col gap-8">
              <div className="flex flex-col gap-4 p-5 bg-slate-50 border border-slate-200 rounded-2xl">
                 <div className="flex justify-between items-center">
                    <div>
                       <h3 className="font-bold text-slate-900">Marketing & Sales Fleet</h3>
                       <p className="text-sm text-slate-500">Outreach, content generation, lead scoring.</p>
                    </div>
                    <div className="text-right">
                       <span className="text-2xl font-black text-slate-900">$2,000</span>
                       <span className="text-sm text-slate-500">/day max</span>
                    </div>
                 </div>
                 <div className="relative pt-4">
                    <input type="range" min="0" max="5000" className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-yellow-600" defaultValue="2000" />
                    <div className="absolute top-0 left-[40%] text-xs font-bold text-[#FACC15] bg-yellow-100 px-2 py-0.5 rounded -translate-x-1/2 -mt-4">Current Usage: $1,420</div>
                 </div>
              </div>

              <div className="flex flex-col gap-4 p-5 bg-slate-50 border border-slate-200 rounded-2xl">
                 <div className="flex justify-between items-center">
                    <div>
                       <h3 className="font-bold text-slate-900">Engineering & Support Fleet</h3>
                       <p className="text-sm text-slate-500">Code review, automated tickets, documentation.</p>
                    </div>
                    <div className="text-right">
                       <span className="text-2xl font-black text-slate-900">$500</span>
                       <span className="text-sm text-slate-500">/day max</span>
                    </div>
                 </div>
                 <div className="relative pt-4">
                    <input type="range" min="0" max="2000" className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-yellow-600" defaultValue="500" />
                    <div className="absolute top-0 left-[80%] text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded -translate-x-1/2 -mt-4">Current Usage: $480</div>
                 </div>
              </div>

           </div>
        </div>

        {/* Recent Charges Table */}
        <div className="lg:col-span-3 bg-white rounded-[32px] shadow-[0_20px_40px_-10px_rgba(30,41,59,0.06)] border border-slate-100 p-8">
           <div className="flex items-center justify-between mb-8 border-b border-slate-100 pb-4">
              <h2 className="text-xl font-bold text-slate-900">Recent API Charges</h2>
              <button className="flex items-center gap-2 text-sm font-bold text-[#FACC15] hover:text-[#EAB308] bg-yellow-50 px-4 py-2 rounded-lg transition-colors">
                 <Download className="size-4" /> Export CSV
              </button>
           </div>
           
           <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                   <tr className="text-slate-500 border-b border-slate-200 bg-slate-50/50">
                      <th className="py-4 px-4 font-bold uppercase tracking-wider">Date/Time</th>
                      <th className="py-4 px-4 font-bold uppercase tracking-wider">Agent/Role</th>
                      <th className="py-4 px-4 font-bold uppercase tracking-wider">Provider/Model</th>
                      <th className="py-4 px-4 font-bold uppercase tracking-wider">Tokens (In/Out)</th>
                      <th className="py-4 px-4 font-bold uppercase tracking-wider text-right">Cost</th>
                   </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                   <tr className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-4 px-4 font-medium text-slate-900 whitespace-nowrap">Oct 24, 14:32:01</td>
                      <td className="py-4 px-4 text-slate-600">Marketing Lead Aria</td>
                      <td className="py-4 px-4 text-slate-600"><span className="px-2 py-1 bg-emerald-50 text-emerald-700 font-semibold rounded mr-2">OpenAI</span> gpt-4-turbo</td>
                      <td className="py-4 px-4 text-slate-500 font-mono">14k / 2.1k</td>
                      <td className="py-4 px-4 font-bold text-slate-900 text-right">-$0.18</td>
                   </tr>
                   <tr className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-4 px-4 font-medium text-slate-900 whitespace-nowrap">Oct 24, 14:15:22</td>
                      <td className="py-4 px-4 text-slate-600">DevTools Agent 03</td>
                      <td className="py-4 px-4 text-slate-600"><span className="px-2 py-1 bg-purple-50 text-purple-700 font-semibold rounded mr-2">Anthropic</span> claude-3-opus</td>
                      <td className="py-4 px-4 text-slate-500 font-mono">45k / 1.5k</td>
                      <td className="py-4 px-4 font-bold text-slate-900 text-right">-$0.85</td>
                   </tr>
                   <tr className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-4 px-4 font-medium text-slate-900 whitespace-nowrap">Oct 24, 13:58:10</td>
                      <td className="py-4 px-4 text-slate-600">Support Helper</td>
                      <td className="py-4 px-4 text-slate-600"><span className="px-2 py-1 bg-emerald-50 text-emerald-700 font-semibold rounded mr-2">OpenAI</span> gpt-3.5-turbo</td>
                      <td className="py-4 px-4 text-slate-500 font-mono">2.1k / 0.4k</td>
                      <td className="py-4 px-4 font-bold text-slate-900 text-right">-$0.01</td>
                   </tr>
                   <tr className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-4 px-4 font-medium text-slate-900 whitespace-nowrap">Oct 24, 13:40:05</td>
                      <td className="py-4 px-4 text-slate-600">Marketing Lead Aria</td>
                      <td className="py-4 px-4 text-slate-600"><span className="px-2 py-1 bg-yellow-50 text-[#EAB308] font-semibold rounded mr-2">Google</span> gemini-1.5-pro</td>
                      <td className="py-4 px-4 text-slate-500 font-mono">120k / 8k</td>
                      <td className="py-4 px-4 font-bold text-slate-900 text-right">-$1.20</td>
                   </tr>
                </tbody>
              </table>
           </div>

        </div>

      </div>
    </div>
  )
}
