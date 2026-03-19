import { Download, BarChart2, PieChart } from 'lucide-react'

export default function CostAnalyticsAndReports() {
  return (
    <div className="flex flex-col gap-8 w-full min-h-full animate-in fade-in duration-500 pb-10">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Cost Analytics & Reports</h1>
          <p className="text-slate-500 mt-1">Deep dive into token consumption, historical spend, and forecast planning.</p>
        </div>
        <div className="flex items-center gap-3">
           <select className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#FACC15]/20">
              <option>Last 30 Days</option>
              <option>Last 7 Days</option>
              <option>This Quarter</option>
              <option>Year to Date</option>
           </select>
           <button className="flex items-center gap-2 bg-[#FACC15] hover:bg-[#EAB308] text-slate-900 px-5 py-2.5 rounded-xl font-bold shadow-[0_8px_16px_-4px_rgba(37,99,235,0.4)] transition-all hover:-translate-y-0.5">
             <Download className="size-4" /> Export Report
           </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Main Chart Graphic - Spend Over Time */}
        <div className="lg:col-span-2 bg-white rounded-[32px] shadow-[0_20px_40px_-10px_rgba(30,41,59,0.06)] border border-slate-100 p-8">
           <div className="flex items-center justify-between mb-8 pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                 <BarChart2 className="size-6 text-[#FACC15]" />
                 <h2 className="text-xl font-bold text-slate-900">Spend Over Time</h2>
              </div>
              <div className="flex items-center gap-4 text-sm font-bold">
                 <div className="flex items-center gap-2"><div className="size-3 bg-[#FACC15] rounded-sm"></div> AI Compute</div>
                 <div className="flex items-center gap-2"><div className="size-3 bg-slate-200 rounded-sm"></div> Data Scraping</div>
              </div>
           </div>

           {/* Pure CSS Bar Chart Mockup */}
           <div className="h-64 flex items-end justify-between gap-2 md:gap-4 px-2 mt-12 w-full pt-8 relative">
              {/* Y Axis Guides */}
              <div className="absolute inset-y-0 left-0 w-full flex flex-col justify-between pt-8 pb-6 border-l border-slate-100 pl-2">
                 <div className="w-full border-t border-slate-100/50 relative"><span className="absolute -top-3 -left-12 text-xs font-semibold text-slate-400 font-mono">$2k</span></div>
                 <div className="w-full border-t border-slate-100/50 relative"><span className="absolute -top-3 -left-12 text-xs font-semibold text-slate-400 font-mono">$1k</span></div>
                 <div className="w-full border-t border-slate-100/50 relative"><span className="absolute -top-3 -left-12 text-xs font-semibold text-slate-400 font-mono">$0</span></div>
              </div>
              
              {/* Bars */}
              {[45, 60, 40, 80, 95, 75, 55, 65, 85, 90, 70, 85].map((height, i) => (
                <div key={i} className="relative flex flex-col items-center flex-1 h-full justify-end group z-10">
                   <div className="opacity-0 group-hover:opacity-100 absolute -top-10 bg-slate-900 text-white text-xs font-bold px-2 py-1 rounded shadow-lg transition-opacity whitespace-nowrap z-20">
                     ${(height * 20).toFixed(0)}
                   </div>
                   <div className="w-full max-w-[40px] bg-slate-200 rounded-t-sm" style={{ height: `${height * 0.2}%` }}></div>
                   <div className="w-full max-w-[40px] bg-[#FACC15] rounded-b border-t border-yellow-700" style={{ height: `${height}%` }}></div>
                   <span className="text-xs font-semibold text-slate-400 mt-3 absolute -bottom-6">Oct {i + 1 * 2}</span>
                </div>
              ))}
           </div>
        </div>

        {/* Breakdown by Provider */}
        <div className="bg-white rounded-[32px] shadow-[0_20px_40px_-10px_rgba(30,41,59,0.06)] border border-slate-100 p-8 flex flex-col">
           <div className="flex items-center gap-2 mb-8 pb-4 border-b border-slate-100">
              <PieChart className="size-5 text-[#FACC15]" />
              <h2 className="text-xl font-bold text-slate-900">Provider Breakdown</h2>
           </div>

           <div className="flex-1 flex flex-col justify-center">
              {/* Horizontal stacked bar for simple breakdown */}
              <div className="w-full h-8 rounded-xl overflow-hidden flex mb-8">
                 <div className="h-full bg-emerald-500 w-[55%] flex items-center px-3 font-bold text-white text-xs">55%</div>
                 <div className="h-full bg-purple-500 w-[30%] flex items-center px-3 font-bold text-white text-xs">30%</div>
                 <div className="h-full bg-yellow-500 w-[10%] flex items-center px-3 font-bold text-white text-xs">10%</div>
                 <div className="h-full bg-slate-300 w-[5%] flex items-center px-1 font-bold text-slate-600 text-[10px]">5%</div>
              </div>

              <div className="flex flex-col gap-4 w-full">
                 <div className="flex justify-between items-center p-3 rounded-xl border border-slate-100 hover:bg-slate-50">
                    <div className="flex items-center gap-3"><div className="size-4 rounded bg-emerald-500"></div><span className="font-bold text-slate-700">OpenAI</span></div>
                    <span className="font-mono font-bold text-slate-900">$10,147.61</span>
                 </div>
                 <div className="flex justify-between items-center p-3 rounded-xl border border-slate-100 hover:bg-slate-50">
                    <div className="flex items-center gap-3"><div className="size-4 rounded bg-purple-500"></div><span className="font-bold text-slate-700">Anthropic</span></div>
                    <span className="font-mono font-bold text-slate-900">$5,535.06</span>
                 </div>
                 <div className="flex justify-between items-center p-3 rounded-xl border border-slate-100 hover:bg-slate-50">
                    <div className="flex items-center gap-3"><div className="size-4 rounded bg-yellow-500"></div><span className="font-bold text-slate-700">Google Gemini</span></div>
                    <span className="font-mono font-bold text-slate-900">$1,845.02</span>
                 </div>
                 <div className="flex justify-between items-center p-3 rounded-xl border border-slate-100 hover:bg-slate-50">
                    <div className="flex items-center gap-3"><div className="size-4 rounded bg-slate-300"></div><span className="font-bold text-slate-700">Other / Data</span></div>
                    <span className="font-mono font-bold text-slate-900">$922.51</span>
                 </div>
              </div>
           </div>
        </div>

        {/* Breakdown by Agent Role */}
        <div className="bg-white rounded-[32px] shadow-[0_20px_40px_-10px_rgba(30,41,59,0.06)] border border-slate-100 p-8 flex flex-col">
           <div className="flex items-center gap-2 mb-8 pb-4 border-b border-slate-100">
              <PieChart className="size-5 text-[#FACC15]" />
              <h2 className="text-xl font-bold text-slate-900">Role Breakdown</h2>
           </div>

           <div className="flex-1 flex flex-col justify-center">
              <div className="space-y-6 w-full">
                 <div className="flex flex-col gap-2">
                    <div className="flex justify-between text-sm font-bold text-slate-800">
                       <span>Marketing & Outreach</span><span>$8,400</span>
                    </div>
                    <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-pink-500 w-[45%]"></div></div>
                 </div>
                 <div className="flex flex-col gap-2">
                    <div className="flex justify-between text-sm font-bold text-slate-800">
                       <span>Engineering & DevTools</span><span>$5,200</span>
                    </div>
                    <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-indigo-500 w-[28%]"></div></div>
                 </div>
                 <div className="flex flex-col gap-2">
                    <div className="flex justify-between text-sm font-bold text-slate-800">
                       <span>Data Analytics</span><span>$3,100</span>
                    </div>
                    <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-cyan-500 w-[17%]"></div></div>
                 </div>
                 <div className="flex flex-col gap-2">
                    <div className="flex justify-between text-sm font-bold text-slate-800">
                       <span>Customer Support</span><span>$1,750</span>
                    </div>
                    <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-amber-500 w-[10%]"></div></div>
                 </div>
              </div>
           </div>
        </div>

      </div>
    </div>
  )
}
