import Link from 'next/link'
import { Plus, Search, Filter, MoreHorizontal, Activity, Clock, Play } from 'lucide-react'

const agents = [
  { id: '1', name: 'EmailBot Beta', role: 'Support Representative', advisor: 'Aria', task: 'Drafting outbound emails', uptime: '99.9%', avatar: '✉️', status: 'Active' },
  { id: '2', name: 'DataCruncher v2', role: 'Data Analyst', advisor: 'Atlas', task: 'Parsing Q3 CSV logs', uptime: '98.5%', avatar: '📊', status: 'Active' },
  { id: '3', name: 'Sales Closer Gen', role: 'Sales Dev Rep', advisor: 'Aria', task: 'Idle', uptime: '100%', avatar: '🤝', status: 'Idle' },
  { id: '4', name: 'CodeRev Bot', role: 'Software Engineer', advisor: 'Neo', task: 'Reviewing PR #402', uptime: '99.1%', avatar: '💻', status: 'Active' },
  { id: '5', name: 'Support Helper', role: 'Support Representative', advisor: 'Echo', task: 'Triaging Ticket #9012', uptime: '95.2%', avatar: '💬', status: 'Active' },
  { id: '6', name: 'Research Scraper', role: 'Data Analyst', advisor: 'Atlas', task: 'Rate Limited (Anthropic)', uptime: '89.4%', avatar: '🔍', status: 'Error' },
]

export default function AgentFleetOverview() {
  return (
    <div className="flex flex-col gap-6 w-full min-h-full animate-in fade-in duration-500 pb-10">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Agent Fleet</h1>
          <p className="text-slate-500 mt-1">Monitor and assign tasks to your operational AI workforce.</p>
        </div>
        <Link href="/fleet/new" className="flex items-center gap-2 bg-[#FACC15] hover:bg-[#EAB308] text-slate-900 px-5 py-2.5 rounded-xl font-bold shadow-[0_8px_16px_-4px_rgba(37,99,235,0.4)] transition-all hover:-translate-y-0.5 w-fit">
          <Plus className="size-5" /> Provision New Agent
        </Link>
      </div>

      {/* Filters and Search Bar */}
      <div className="bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 p-4 flex flex-col md:flex-row gap-4">
         <div className="relative flex-1">
           <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-slate-400" />
           <input type="text" placeholder="Search by name, role, or task..." className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium focus:outline-none focus:ring-2 focus:ring-[#FACC15]/20 focus:border-[#FACC15] transition-colors" />
         </div>
         <div className="flex gap-3">
            <select className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#FACC15]/20">
               <option>All Roles</option>
               <option>Support Representative</option>
               <option>Data Analyst</option>
               <option>Software Engineer</option>
               <option>Sales Dev Rep</option>
            </select>
            <select className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#FACC15]/20">
               <option>All Advisors</option>
               <option>Aria</option>
               <option>Atlas</option>
               <option>Neo</option>
               <option>Echo</option>
            </select>
            <button className="p-2.5 border border-slate-200 rounded-xl text-slate-500 hover:bg-slate-50 transition-colors bg-white"><Filter className="size-5" /></button>
         </div>
      </div>

      {/* Grid of Agents */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {agents.map((agent) => (
          <div key={agent.id} className="bg-white rounded-[24px] shadow-[0_10px_30px_-10px_rgba(30,41,59,0.05)] border border-slate-100 p-6 flex flex-col hover:shadow-[0_20px_40px_-10px_rgba(30,41,59,0.1)] transition-shadow">
            
            <div className="flex justify-between items-start mb-4">
               <div className="flex items-center gap-3">
                  <div className="size-12 rounded-full bg-slate-100 flex items-center justify-center text-2xl border-2 border-white shadow-sm">
                    {agent.avatar}
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 leading-tight"><Link href={`/fleet/${agent.id}`} className="hover:text-[#FACC15] transition-colors">{agent.name}</Link></h3>
                    <p className="text-xs text-slate-500 font-medium">{agent.role}</p>
                  </div>
               </div>
               <button className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-full transition-colors"><MoreHorizontal className="size-5" /></button>
            </div>

            <div className="flex flex-col gap-3 mb-6 bg-slate-50 p-4 rounded-xl border border-slate-100 flex-1">
               <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-500 font-medium flex items-center gap-1.5"><Activity className="size-4" /> Status</span>
                  {agent.status === 'Active' && <span className="font-bold text-[#FACC15] flex items-center gap-1.5"><div className="size-2 rounded-full bg-[#FACC15] animate-pulse"></div> Active</span>}
                  {agent.status === 'Idle' && <span className="font-bold text-slate-500 flex items-center gap-1.5"><div className="size-2 rounded-full bg-slate-400"></div> Idle</span>}
                  {agent.status === 'Error' && <span className="font-bold text-red-600 flex items-center gap-1.5"><div className="size-2 rounded-full bg-red-600"></div> Error</span>}
               </div>

               <div className="flex justify-between items-start text-sm border-t border-slate-200/60 pt-3">
                  <span className="text-slate-500 font-medium flex items-center gap-1.5 shrink-0"><Play className="size-4" /> Current Task</span>
                  <span className="font-semibold text-slate-900 text-right line-clamp-2">{agent.task}</span>
               </div>

               <div className="flex justify-between items-center text-sm border-t border-slate-200/60 pt-3">
                  <span className="text-slate-500 font-medium flex items-center gap-1.5"><Clock className="size-4" /> Uptime</span>
                  <span className="font-bold text-emerald-600">{agent.uptime}</span>
               </div>
            </div>

            <div className="flex items-center justify-between mt-auto">
               <div className="flex items-center gap-2">
                 <span className="text-xs text-slate-500 font-medium">Advisor:</span>
                 <span className="text-xs font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">{agent.advisor}</span>
               </div>
               <button className="text-sm font-bold text-[#FACC15] bg-yellow-50 hover:bg-yellow-100 px-4 py-2 rounded-lg transition-colors">
                  Assign Task
               </button>
            </div>

          </div>
        ))}
      </div>

    </div>
  )
}
