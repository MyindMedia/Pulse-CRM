import Link from 'next/link'
import { ArrowLeft, Target, Code, Activity, ShieldAlert, Cpu } from 'lucide-react'

export default function AdvisorDetailProfile() {
  return (
    <div className="flex flex-col gap-8 w-full min-h-full animate-in fade-in duration-500 pb-10">
      
      {/* Top Banner & Header */}
      <div className="bg-slate-900 rounded-[32px] p-8 md:p-12 text-white relative overflow-hidden flex flex-col pt-12">
        {/* Background Effects */}
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-[#FACC15]/20 blur-[100px] rounded-full -translate-y-1/2 translate-x-1/3"></div>
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-purple-600/20 blur-[100px] rounded-full translate-y-1/2 -translate-x-1/4"></div>

        <Link href="/advisors" className="absolute top-8 left-8 flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm font-bold bg-white/10 px-4 py-2 rounded-xl backdrop-blur-md z-10">
           <ArrowLeft className="size-4" /> Back to Fleet
        </Link>
        
        <div className="relative z-10 flex flex-col md:flex-row gap-8 items-start md:items-center mt-8">
           <div className="size-32 rounded-full border-4 border-slate-800 bg-gradient-to-br from-indigo-500 to-pink-500 p-1.5 shadow-2xl">
              <div className="w-full h-full bg-slate-900 rounded-full flex items-center justify-center text-5xl">👑</div>
           </div>
           <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                 <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Aria</h1>
                 <span className="px-3 py-1 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-bold rounded-full uppercase tracking-wider backdrop-blur-sm">System Healthy</span>
              </div>
              <p className="text-xl text-slate-400">Lead Orchestrator</p>
           </div>
           <div className="flex flex-col gap-3 min-w-[200px]">
             <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/10">
               <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Managed Budget</p>
               <p className="text-2xl font-bold font-mono text-emerald-400">$840,000</p>
             </div>
           </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        
        {/* Left Column: Instructions & Code */}
        <div className="xl:col-span-2 flex flex-col gap-8">
          
          <div className="bg-white rounded-[32px] shadow-[0_20px_40px_-10px_rgba(30,41,59,0.06)] border border-slate-100 overflow-hidden">
             <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Code className="size-5 text-[#FACC15]" />
                  <h2 className="text-lg font-bold text-slate-900">System Instructions (Prompt)</h2>
                </div>
                <button className="text-sm font-bold text-[#FACC15] hover:text-[#EAB308]">Edit Prompt</button>
             </div>
             <div className="p-6 bg-slate-900 text-slate-300 font-mono text-sm leading-relaxed max-h-[400px] overflow-y-auto">
<pre className="whitespace-pre-wrap">
{`You are Aria, the Lead Orchestrator for the entire AI agent fleet at Acme Corp. Your primary objective is to maximize pipeline value while keeping budget consumption strictly under 90% of the daily limit.

RULES:
1. Do not exceed $5,000 daily spend across your subordinate agents.
2. If API limits trigger a 429 response from Anthropic, immediately fallback to Gemini 1.5 Pro.
3. Every 6 hours, generate a summary of lead movement across the funnel.

SUBORDINATES LIST:
- EmailBot Beta (Outreach)
- DataCruncher v2 (Data Parsing)
- Support Helper (Ticketing)

When making decisions involving resource reallocation, prioritize 'Lead Score > 80' above all other factors...`}
</pre>
             </div>
          </div>

          <div className="bg-white rounded-[32px] shadow-[0_20px_40px_-10px_rgba(30,41,59,0.06)] border border-slate-100 p-8">
             <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-2">
                  <Activity className="size-5 text-[#FACC15]" />
                  <h2 className="text-lg font-bold text-slate-900">Live Orchestration Log</h2>
                </div>
                <div className="flex items-center gap-2">
                   <div className="size-2 bg-red-500 rounded-full animate-pulse"></div>
                   <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Live</span>
                </div>
             </div>
             
             <div className="space-y-4 font-mono text-sm">
                <div className="flex gap-4 items-start p-4 bg-slate-50 border border-slate-200 rounded-xl">
                   <span className="text-slate-400 shrink-0">14:02:15</span>
                   <span className="text-[#FACC15] font-bold shrink-0">[DECISION]</span>
                   <span className="text-slate-800">Reallocating +$40.00 compute limit to <span className="font-semibold px-1 bg-yellow-100 text-yellow-800 rounded">EmailBot Beta</span> due to burst in inbound leads.</span>
                </div>
                <div className="flex gap-4 items-start p-4 bg-slate-50 border border-slate-200 rounded-xl">
                   <span className="text-slate-400 shrink-0">13:45:00</span>
                   <span className="text-emerald-600 font-bold shrink-0">[METRIC]</span>
                   <span className="text-slate-800">Routine systems check passed. Agent fleet efficiency rating at 92%. Cost projection stable.</span>
                </div>
                <div className="flex gap-4 items-start p-4 bg-red-50 border border-red-100 rounded-xl">
                   <span className="text-slate-400 shrink-0">12:10:44</span>
                   <span className="text-red-600 font-bold shrink-0">[ERROR_HANDLE]</span>
                   <span className="text-slate-800">DataCruncher v2 hit token limit. Pausing DataCruncher for 15 minutes. Falling back to cached lead data.</span>
                </div>
             </div>
          </div>
        </div>

        {/* Right Column: Performance & Charts */}
        <div className="flex flex-col gap-8">
           
           {/* Performance Radar - Mockup */}
           <div className="bg-white rounded-[32px] shadow-[0_20px_40px_-10px_rgba(30,41,59,0.06)] border border-slate-100 p-8 flex flex-col items-center">
              <h2 className="text-lg font-bold text-slate-900 mb-8 self-start w-full border-b border-slate-100 pb-4">Performance vs Goals</h2>
              
              <div className="relative size-64 flex items-center justify-center">
                 {/* Standard visual progress bar logic translated to a radar-like mockup */}
                 <div className="absolute inset-0 border-[8px] border-slate-100 rounded-full"></div>
                 <div className="absolute inset-0 border-[8px] border-[#FACC15] rounded-full clip-half rotate-45 opacity-20"></div>
                 <div className="relative z-10 text-center">
                    <span className="text-4xl font-black text-slate-900">92</span>
                    <span className="text-sm font-bold text-slate-400 block uppercase tracking-wide">Orchestration Score</span>
                 </div>
              </div>

              <div className="w-full flex justify-between mt-8 text-sm">
                 <div className="flex flex-col items-center"><span className="font-bold text-emerald-600">98%</span><span className="text-slate-500 text-xs">Uptime</span></div>
                 <div className="flex flex-col items-center"><span className="font-bold text-[#FACC15]">85%</span><span className="text-slate-500 text-xs">Cost Efficency</span></div>
                 <div className="flex flex-col items-center"><span className="font-bold text-purple-600">42k</span><span className="text-slate-500 text-xs">Tasks Handled</span></div>
              </div>
           </div>

           {/* Resource Allocation */}
           <div className="bg-white rounded-[32px] shadow-[0_20px_40px_-10px_rgba(30,41,59,0.06)] border border-slate-100 p-8">
              <h2 className="text-lg font-bold text-slate-900 mb-6 w-full border-b border-slate-100 pb-4">Resource Allocation</h2>
              
              <div className="flex flex-col gap-5">
                 <div className="space-y-2">
                    <div className="flex justify-between text-sm font-semibold">
                       <span className="text-slate-700 flex items-center gap-2"><div className="size-3 rounded-sm bg-[#FACC15]"></div> Email Outreach</span>
                       <span className="text-slate-900">$420k (50%)</span>
                    </div>
                    <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                       <div className="bg-[#FACC15] h-full w-[50%] rounded-full"></div>
                    </div>
                 </div>

                 <div className="space-y-2">
                    <div className="flex justify-between text-sm font-semibold">
                       <span className="text-slate-700 flex items-center gap-2"><div className="size-3 rounded-sm bg-purple-500"></div> Data Processing</span>
                       <span className="text-slate-900">$294k (35%)</span>
                    </div>
                    <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                       <div className="bg-purple-500 h-full w-[35%] rounded-full"></div>
                    </div>
                 </div>

                 <div className="space-y-2">
                    <div className="flex justify-between text-sm font-semibold">
                       <span className="text-slate-700 flex items-center gap-2"><div className="size-3 rounded-sm bg-amber-400"></div> Customer Support</span>
                       <span className="text-slate-900">$126k (15%)</span>
                    </div>
                    <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                       <div className="bg-amber-400 h-full w-[15%] rounded-full"></div>
                    </div>
                 </div>
              </div>
           </div>

        </div>

      </div>
    </div>
  )
}
