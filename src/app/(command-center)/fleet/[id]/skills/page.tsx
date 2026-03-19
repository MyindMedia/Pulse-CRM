import Link from 'next/link'
import { ArrowLeft, Play, Settings, BookOpen, TerminalSquare, Search, Plus, Save } from 'lucide-react'

const availableSkills = [
  { id: 'web', name: 'Web Browsing', icon: '🌐', active: true },
  { id: 'db_read', name: 'Database Query (Read)', icon: '📖', active: true },
  { id: 'db_write', name: 'Database Query (Write)', icon: '💾', active: false },
  { id: 'code_exec', name: 'Python Execution', icon: '🐍', active: false },
  { id: 'email_send', name: 'Send Grid Integration', icon: '✉️', active: true },
  { id: 'slack', name: 'Slack Messaging', icon: '💬', active: false },
]

export default function AgentSkillsConfig() {
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
                 <p className="text-slate-500 font-medium text-sm">Skills & Prompts Configuration</p>
              </div>
           </div>
           <button className="flex items-center gap-2 bg-[#FACC15] hover:bg-[#EAB308] text-slate-900 px-5 py-2.5 rounded-xl font-bold shadow-[0_8px_16px_-4px_rgba(37,99,235,0.4)] transition-all hover:-translate-y-0.5 w-fit">
              <Save className="size-4" /> Save Changes
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
            <Link href="/fleet/1/skills" className="px-6 py-3 font-bold text-sm border-b-2 transition-colors whitespace-nowrap border-[#FACC15] text-[#FACC15]">
               <span className="flex items-center gap-2"><BookOpen className="size-4" /> Skills & Prompts</span>
            </Link>
            <Link href="/fleet/1/logs" className="px-6 py-3 font-bold text-sm border-b-2 transition-colors whitespace-nowrap border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300">
               <span className="flex items-center gap-2"><TerminalSquare className="size-4" /> Live API Logs</span>
            </Link>
            <Link href="#" className="px-6 py-3 font-bold text-sm border-b-2 transition-colors whitespace-nowrap border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300">
               <span className="flex items-center gap-2"><Settings className="size-4" /> Settings</span>
            </Link>
         </div>

         <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            
            {/* Left Col: Prompt Editor */}
            <div className="flex flex-col gap-4">
               <h2 className="text-lg font-bold text-slate-900">Base Prompt Editor</h2>
               <div className="bg-slate-900 rounded-[24px] shadow-[0_20px_40px_-10px_rgba(30,41,59,0.06)] overflow-hidden flex flex-col h-[500px]">
                  <div className="bg-slate-800 px-4 py-3 flex items-center justify-between border-b border-slate-700">
                     <div className="flex items-center gap-2">
                        <div className="flex gap-1.5">
                           <div className="size-3 rounded-full bg-red-400"></div>
                           <div className="size-3 rounded-full bg-yellow-400"></div>
                           <div className="size-3 rounded-full bg-emerald-400"></div>
                        </div>
                        <span className="text-slate-400 text-xs font-mono ml-2">system_prompt.txt</span>
                     </div>
                     <span className="text-xs text-slate-500">Unsaved changes</span>
                  </div>
                  <textarea 
                     className="w-full h-full bg-slate-900 text-slate-300 p-6 font-mono text-sm resize-none focus:outline-none focus:ring-1 focus:ring-yellow-500/50 leading-relaxed"
                     defaultValue={`You are EmailBot Beta, the primary outbound outreach agent. Your goal is to draft highly personalized emails to leads assigned by DataCruncher v2.

CRITICAL INSTRUCTIONS:
1. Tone must be professional, brief, and empathetic. 
2. Never exceed 3 short paragraphs.
3. Always include the Acme Corp standard signature.
4. If a lead score is >80, offer a Calendly link immediately.

Make sure to utilize the Send Grid Integration skill to queue emails after drafting.
Always verify email formatting before submitting.`}
                  />
               </div>
            </div>

            {/* Right Col: Skills Tooling */}
            <div className="flex flex-col gap-4">
               <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-slate-900">Plugin Skills</h2>
                  <button className="text-sm font-bold text-[#FACC15] hover:text-[#EAB308] flex items-center gap-1"><Plus className="size-4" /> Browse Plugin Store</button>
               </div>
               
               <div className="bg-white rounded-[24px] shadow-[0_20px_40px_-10px_rgba(30,41,59,0.06)] border border-slate-100 p-6 flex flex-col gap-6 h-[500px]">
                  
                  <div className="relative">
                     <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
                     <input type="text" placeholder="Search installed skills..." className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#FACC15]/20 focus:border-[#FACC15] transition-colors" />
                  </div>

                  <div className="flex-1 overflow-y-auto pr-2 space-y-3">
                     {availableSkills.map((skill) => (
                        <div key={skill.id} className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${skill.active ? 'bg-yellow-50/50 border-yellow-200' : 'bg-slate-50 border-slate-200 opacity-70'}`}>
                           <div className="flex items-center gap-4">
                              <span className="text-2xl drop-shadow-sm">{skill.icon}</span>
                              <span className={`font-bold ${skill.active ? 'text-yellow-900' : 'text-slate-700'}`}>{skill.name}</span>
                           </div>
                           
                           {/* Custom Toggle Switch */}
                           <label className="relative inline-flex items-center cursor-pointer">
                             <input type="checkbox" className="sr-only peer" defaultChecked={skill.active} />
                             <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-yellow-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#FACC15]"></div>
                           </label>
                        </div>
                     ))}
                  </div>

               </div>
            </div>

         </div>
      </div>
    </div>
  )
}
