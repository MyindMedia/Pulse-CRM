import { Building2, Plus, ArrowRight, Settings2 } from 'lucide-react'

const companies = [
  { id: 1, name: 'Acme Corp', tier: 'Enterprise', active: true, agents: 12, spend: '$3,402' },
  { id: 2, name: 'Global Tech LLC', tier: 'Pro', active: false, agents: 4, spend: '$890' },
  { id: 3, name: 'Stark Industries', tier: 'Enterprise', active: false, agents: 45, spend: '$12,050' },
]

export default function CompaniesSettings() {
  return (
    <div className="flex flex-col gap-8 min-h-full">
       <div className="flex justify-between items-end pb-4 border-b border-slate-100">
          <div>
             <h2 className="text-xl font-bold text-slate-900 mb-1">Company Portfolio</h2>
             <p className="text-sm text-slate-500">Manage and switch between your affiliated organizations.</p>
          </div>
          <button className="flex items-center gap-2 bg-[#FACC15] hover:bg-[#EAB308] text-slate-900 px-5 py-2.5 rounded-xl font-bold shadow-[0_8px_16px_-4px_rgba(37,99,235,0.4)] transition-all hover:-translate-y-0.5">
             <Plus className="size-4" /> Create Workspace
          </button>
       </div>

       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {companies.map((company) => (
             <div key={company.id} className={`group relative flex flex-col justify-between p-6 rounded-[24px] border transition-all duration-300 hover:shadow-[0_20px_40px_-10px_rgba(30,41,59,0.06)] hover:-translate-y-1 ${company.active ? 'bg-[#FACC15] border-[#FACC15] shadow-[0_10px_30px_-10px_rgba(37,99,235,0.4)]' : 'bg-white border-slate-200'}`}>
                
                {/* Active Indicator Badge */}
                {company.active && (
                   <div className="absolute top-0 right-6 -translate-y-1/2 bg-yellow-400 text-yellow-900 text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-full border-2 border-white shadow-sm">
                      Current
                   </div>
                )}

                <div className="flex flex-col gap-4">
                   <div className="flex items-center justify-between">
                      <div className={`p-3 rounded-2xl ${company.active ? 'bg-white/20 text-white' : 'bg-slate-100 text-[#FACC15]'}`}>
                         <Building2 className="size-6" />
                      </div>
                      <button className={`p-2 rounded-lg transition-colors ${company.active ? 'text-white/60 hover:bg-white/10 hover:text-white' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-900'}`}>
                         <Settings2 className="size-5" />
                      </button>
                   </div>
                   
                   <div>
                      <h3 className={`text-xl font-extrabold tracking-tight ${company.active ? 'text-white' : 'text-slate-900'}`}>{company.name}</h3>
                      <p className={`text-sm font-medium mt-1 ${company.active ? 'text-yellow-100' : 'text-slate-500'}`}>{company.tier} Plan</p>
                   </div>
                </div>

                <div className={`mt-8 pt-6 border-t flex items-center justify-between ${company.active ? 'border-white/20' : 'border-slate-100'}`}>
                   <div className="flex items-center gap-6">
                      <div className="flex flex-col">
                         <span className={`text-xs font-semibold uppercase tracking-wider ${company.active ? 'text-yellow-200' : 'text-slate-400'}`}>Agents</span>
                         <span className={`text-lg font-bold ${company.active ? 'text-white' : 'text-slate-900'}`}>{company.agents}</span>
                      </div>
                      <div className="flex flex-col">
                         <span className={`text-xs font-semibold uppercase tracking-wider ${company.active ? 'text-yellow-200' : 'text-slate-400'}`}>Mtd Spend</span>
                         <span className={`text-lg font-bold ${company.active ? 'text-white' : 'text-slate-900'}`}>{company.spend}</span>
                      </div>
                   </div>
                   
                   {!company.active && (
                      <button className="size-10 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center text-[#FACC15] transition-colors group-hover:bg-[#FACC15] group-hover:text-white group-hover:border-[#FACC15]">
                         <ArrowRight className="size-4" />
                      </button>
                   )}
                </div>

             </div>
          ))}
       </div>

    </div>
  )
}
