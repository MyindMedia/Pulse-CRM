import { Activity, Search, Filter, ArrowUpRight, CheckCircle2, XCircle } from 'lucide-react'

const auditLogs = [
  { id: 1, action: 'Provisioned Agent', actor: 'John Doe', resource: 'EmailBot Beta', date: 'Oct 24, 2026 14:30', status: 'success' },
  { id: 2, action: 'Rotated API Key', actor: 'Automated System', resource: 'OpenAI (Primary GPT-4)', date: 'Oct 23, 2026 09:12', status: 'success' },
  { id: 3, action: 'Budget Limit Exceeded', actor: 'System Alert', resource: 'Marketing Dept.', date: 'Oct 22, 2026 18:45', status: 'failed' },
  { id: 4, action: 'Updated Advisor Prompt', actor: 'Jane Smith', resource: 'Lead Advisor', date: 'Oct 21, 2026 11:20', status: 'success' },
  { id: 5, action: 'Added User', actor: 'John Doe', resource: 'michael.j@acmecorp.com', date: 'Oct 20, 2026 16:05', status: 'success' },
]

export default function AuditLogSettings() {
  return (
    <div className="flex flex-col gap-8">
       <div className="flex justify-between items-end pb-4 border-b border-slate-100">
          <div>
             <h2 className="text-xl font-bold text-slate-900 mb-1">Audit Log & Tickets</h2>
             <p className="text-sm text-slate-500">Track system activities, configuration changes, and support tickets.</p>
          </div>
          <div className="flex gap-2">
             <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
                <input type="text" placeholder="Search events..." className="pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#FACC15]/20 focus:border-[#FACC15] transition-colors w-64" />
             </div>
             <button className="p-2 border border-slate-200 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors">
                <Filter className="size-4" />
             </button>
          </div>
       </div>

       <div className="flex flex-col gap-0 border border-slate-100 rounded-[20px] overflow-hidden">
          
          <table className="w-full text-left border-collapse">
             <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100">
                   <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Event / Action</th>
                   <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Actor</th>
                   <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Resource / Target</th>
                   <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Date & Time</th>
                   <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Details</th>
                </tr>
             </thead>
             <tbody className="divide-y divide-slate-100">
                {auditLogs.map((log) => (
                   <tr key={log.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-6 py-4">
                         <div className="flex items-center gap-3">
                            {log.status === 'success' ? (
                               <div className="p-1.5 rounded-full bg-emerald-100 text-emerald-600">
                                  <CheckCircle2 className="size-4" />
                               </div>
                            ) : (
                               <div className="p-1.5 rounded-full bg-red-100 text-red-600">
                                  <XCircle className="size-4" />
                               </div>
                            )}
                            <span className="font-bold text-slate-900 text-sm">{log.action}</span>
                         </div>
                      </td>
                      <td className="px-6 py-4">
                         <span className={`text-sm font-medium px-2.5 py-1 rounded inline-flex ${log.actor.includes('System') ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>
                            {log.actor}
                         </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600 font-medium">
                         {log.resource}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-500 font-medium whitespace-nowrap">
                         {log.date}
                      </td>
                      <td className="px-6 py-4 text-right">
                         <button className="inline-flex items-center justify-center p-2 text-slate-400 hover:text-[#FACC15] transition-colors rounded-lg hover:bg-yellow-50">
                            <ArrowUpRight className="size-4" />
                         </button>
                      </td>
                   </tr>
                ))}
             </tbody>
          </table>

       </div>

       {/* Support Tickets Promo Section */}
       <div className="mt-4 bg-yellow-50 border border-yellow-100 rounded-2xl p-6 flex items-center justify-between">
          <div className="flex items-start gap-4">
             <div className="p-3 bg-yellow-100 rounded-xl text-[#FACC15]">
                <Activity className="size-6" />
             </div>
             <div>
                <h3 className="text-lg font-bold text-yellow-900 leading-tight">Need technical assistance?</h3>
                <p className="text-[#EAB308] mt-1 text-sm">Open a support ticket to get help from our enterprise engineering team.</p>
             </div>
          </div>
          <button className="bg-[#FACC15] text-slate-900 px-5 py-2.5 rounded-xl font-bold shadow-sm hover:bg-[#EAB308] transition-colors whitespace-nowrap">
             Create Ticket
          </button>
       </div>

    </div>
  )
}
