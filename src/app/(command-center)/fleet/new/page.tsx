import Link from 'next/link'
import { ArrowLeft, Cpu, Shield, Zap } from 'lucide-react'

export default function AddNewAgent() {
  return (
    <div className="flex flex-col gap-6 w-full min-h-full animate-in fade-in duration-500 pb-10">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
           <Link href="/fleet" className="flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-900 transition-colors w-fit">
              <ArrowLeft className="size-4" /> Back to Fleet
           </Link>
           <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Provision New Agent</h1>
           <p className="text-slate-500 mt-1">Configure a new AI worker and deploy to production.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-4">
         
         {/* Main Form Area */}
         <div className="lg:col-span-2 bg-white rounded-[32px] shadow-[0_20px_40px_-10px_rgba(30,41,59,0.06)] border border-slate-100 p-8">
            <h2 className="text-xl font-bold text-slate-900 mb-6 border-b border-slate-100 pb-4">Agent DNA Configuration</h2>
            
            <form className="flex flex-col gap-6">
               <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">Display Name</label>
                  <input 
                    type="text" 
                    placeholder="E.g. Support Helper v3" 
                    className="w-full px-5 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#FACC15]/20 focus:border-[#FACC15] transition-colors bg-white text-slate-800 placeholder:text-slate-400 font-medium"
                  />
               </div>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                     <label className="text-sm font-bold text-slate-700">Operational Role</label>
                     <select className="w-full px-5 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#FACC15]/20 focus:border-[#FACC15] transition-colors bg-white text-slate-800 font-medium appearance-none">
                        <option>Support Representative</option>
                        <option>Data Analyst</option>
                        <option>Software Engineer</option>
                        <option>Sales Development Rep</option>
                        <option>Custom Role...</option>
                     </select>
                  </div>
                  <div className="space-y-2">
                     <label className="text-sm font-bold text-slate-700">Assign to Advisor</label>
                     <select className="w-full px-5 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#FACC15]/20 focus:border-[#FACC15] transition-colors bg-white text-slate-800 font-medium appearance-none">
                        <option>Aria (Lead Orchestrator)</option>
                        <option>Atlas (Data Ops Lead)</option>
                        <option>Neo (CMO)</option>
                        <option>Echo (CS Dir.)</option>
                        <option className="italic">No Advisor (Unmanaged)</option>
                     </select>
                  </div>
               </div>

               <div className="space-y-4 pt-4 border-t border-slate-100 mt-2">
                  <label className="text-sm font-bold text-slate-700">Base Foundation Model</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                     {/* Model Selection Cards */}
                     <label className="relative flex flex-col p-5 cursor-pointer rounded-2xl border-2 border-slate-200 bg-white hover:bg-slate-50 transition-colors has-[:checked]:border-[#FACC15] has-[:checked]:bg-yellow-50/50">
                        <input type="radio" name="base_model" value="gpt4" className="absolute opacity-0" defaultChecked />
                        <div className="flex justify-between items-start mb-2">
                           <div className="flex items-center gap-2">
                              <span className="text-xl">🟢</span>
                              <span className="font-bold text-slate-900">OpenAI GPT-4o</span>
                           </div>
                           <div className="size-5 rounded-full border-2 border-slate-300 flex items-center justify-center bg-white check-indicator">
                              <div className="size-2.5 rounded-full bg-[#FACC15] opacity-0 transition-opacity"></div>
                           </div>
                        </div>
                        <p className="text-xs text-slate-500 font-medium">Best for general reasoning, coding, and complex logic.</p>
                     </label>

                     <label className="relative flex flex-col p-5 cursor-pointer rounded-2xl border-2 border-slate-200 bg-white hover:bg-slate-50 transition-colors has-[:checked]:border-[#FACC15] has-[:checked]:bg-yellow-50/50">
                        <input type="radio" name="base_model" value="claude" className="absolute opacity-0" />
                        <div className="flex justify-between items-start mb-2">
                           <div className="flex items-center gap-2">
                              <span className="text-xl">🟣</span>
                              <span className="font-bold text-slate-900">Claude 3.5 Sonnet</span>
                           </div>
                           <div className="size-5 rounded-full border-2 border-slate-300 flex items-center justify-center bg-white check-indicator">
                              <div className="size-2.5 rounded-full bg-[#FACC15] opacity-0 transition-opacity"></div>
                           </div>
                        </div>
                        <p className="text-xs text-slate-500 font-medium">Exceptional speed, writing quality, and large context windows.</p>
                     </label>

                     <label className="relative flex flex-col p-5 cursor-pointer rounded-2xl border-2 border-slate-200 bg-white hover:bg-slate-50 transition-colors has-[:checked]:border-[#FACC15] has-[:checked]:bg-yellow-50/50">
                        <input type="radio" name="base_model" value="gemini" className="absolute opacity-0" />
                        <div className="flex justify-between items-start mb-2">
                           <div className="flex items-center gap-2">
                              <span className="text-xl">✨</span>
                              <span className="font-bold text-slate-900">Gemini 1.5 Pro</span>
                           </div>
                           <div className="size-5 rounded-full border-2 border-slate-300 flex items-center justify-center bg-white check-indicator">
                              <div className="size-2.5 rounded-full bg-[#FACC15] opacity-0 transition-opacity"></div>
                           </div>
                        </div>
                        <p className="text-xs text-slate-500 font-medium">High multi-modal capabilities and massive context processing.</p>
                     </label>
                  </div>
                  {/* Inline CSS just for the radio button dot effect */}
                  <style>{`
                     label:has(input:checked) .check-indicator { border-color: #2563eb; }
                     label:has(input:checked) .check-indicator div { opacity: 1; }
                  `}</style>
               </div>
            </form>
         </div>

         {/* Right Sidebar: Summary & Actions */}
         <div className="flex flex-col gap-6">
            <div className="bg-slate-900 rounded-[32px] shadow-[0_20px_40px_-10px_rgba(30,41,59,0.06)] p-8 text-white relative overflow-hidden flex flex-col h-full">
               <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-[#FACC15]/20 blur-[80px] rounded-full -translate-y-1/2 translate-x-1/2"></div>
               
               <h2 className="text-lg font-bold text-white mb-6 relative z-10 flex items-center gap-2">
                  <Zap className="size-5 text-yellow-400" /> Deployment Ready
               </h2>

               <div className="flex flex-col gap-4 relative z-10 font-mono text-sm flex-1">
                  <div className="flex items-center gap-3 bg-white/10 p-4 rounded-xl border border-white/5">
                     <Cpu className="size-5 text-yellow-400" />
                     <div>
                        <p className="text-xs text-slate-400 font-sans uppercase tracking-wider mb-0.5">Compute Allocation</p>
                        <p className="font-bold text-emerald-400">Dynamic (Auto-scaling)</p>
                     </div>
                  </div>
                  
                  <div className="flex items-center gap-3 bg-white/10 p-4 rounded-xl border border-white/5">
                     <Shield className="size-5 text-purple-400" />
                     <div>
                        <p className="text-xs text-slate-400 font-sans uppercase tracking-wider mb-0.5">Permissions Level</p>
                        <p className="font-bold text-white">Restricted (Level 2)</p>
                     </div>
                  </div>
               </div>

               <div className="mt-8 relative z-10">
                  <button className="w-full py-4 bg-[#FACC15] hover:bg-yellow-500 text-white rounded-xl font-bold transition-all shadow-lg hover:shadow-yellow-600/50 shadow-yellow-600/30">
                     Deploy Agent
                  </button>
                  <p className="text-center text-xs text-slate-400 mt-4 font-sans">
                     By deploying, you agree to the <a href="#" className="underline hover:text-white">API Usage Terms</a>.
                  </p>
               </div>
            </div>
         </div>

      </div>
    </div>
  )
}
