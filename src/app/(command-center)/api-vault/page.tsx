import { KeySquare, Plus, MoreVertical, Eye, EyeOff, ShieldCheck, AlertCircle, CheckCircle2 } from 'lucide-react'

const apiKeys = [
  { id: 1, provider: 'OpenAI', alias: 'Primary GPT-4', key: 'sk-proj-...8f92', status: 'active', lastUsed: '2 mins ago', env: 'Production' },
  { id: 2, provider: 'Anthropic', alias: 'Claude Opus Fallback', key: 'sk-ant-...a1b2', status: 'active', lastUsed: '1 hour ago', env: 'Production' },
  { id: 3, provider: 'OpenAI', alias: 'Dev Testing', key: 'sk-proj-...3c4d', status: 'warning', lastUsed: '5 days ago', env: 'Development', note: 'Approaching limit' },
  { id: 4, provider: 'SendGrid', alias: 'Marketing Emails', key: 'SG.abcxyz...123', status: 'active', lastUsed: '12 mins ago', env: 'Production' },
]

export default function ApiVault() {
  return (
    <div className="flex flex-col gap-8 w-full min-h-full animate-in fade-in duration-500 pb-10">
      
      {/* Header */}
      <div className="flex justify-between items-end">
         <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">API Key Vault</h1>
            <p className="text-slate-500 font-medium">Securely manage credentials for AI models and integrations.</p>
         </div>
         <button className="flex items-center gap-2 bg-[#FACC15] hover:bg-[#EAB308] text-slate-900 px-5 py-2.5 rounded-xl font-bold shadow-[0_8px_16px_-4px_rgba(37,99,235,0.4)] transition-all hover:-translate-y-0.5">
            <Plus className="size-5" /> Add New Key
         </button>
      </div>

      {/* Security Banner */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 flex items-start gap-4">
         <div className="p-2 bg-emerald-100 rounded-full text-emerald-600 shrink-0 mt-0.5">
            <ShieldCheck className="size-5" />
         </div>
         <div>
            <h3 className="font-bold text-emerald-900 mb-1">Vault Encrypted</h3>
            <p className="text-emerald-700 text-sm leading-relaxed">All API keys are encrypted at rest using AES-256 and are never exposed in plaintext logs. Key rotations are currently managed manually.</p>
         </div>
      </div>

      {/* Keys Table Card */}
      <div className="bg-white rounded-[24px] shadow-[0_20px_40px_-10px_rgba(30,41,59,0.06)] border border-slate-100 overflow-hidden">
         <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
               <KeySquare className="size-5 text-[#FACC15]" /> Active Credentials
            </h2>
            <div className="flex gap-2">
               <select className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#FACC15]/20">
                  <option>All Environments</option>
                  <option>Production</option>
                  <option>Development</option>
               </select>
            </div>
         </div>
         
         <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
               <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                     <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Provider / Alias</th>
                     <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Environment</th>
                     <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">API Key</th>
                     <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                     <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Last Used</th>
                     <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Actions</th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-slate-100">
                  {apiKeys.map((key) => (
                     <tr key={key.id} className="hover:bg-slate-50/50 transition-colors group">
                        <td className="px-6 py-4">
                           <div className="font-bold text-slate-900">{key.provider}</div>
                           <div className="text-sm text-slate-500">{key.alias}</div>
                        </td>
                        <td className="px-6 py-4">
                           <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-bold ${key.env === 'Production' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-700'}`}>
                              {key.env}
                           </span>
                        </td>
                        <td className="px-6 py-4">
                           <div className="flex items-center gap-3">
                              <code className="bg-slate-100 px-2 py-1 rounded text-sm text-slate-700 font-mono tracking-tight break-all max-w-[180px]">{key.key}</code>
                              <button className="text-slate-400 hover:text-[#FACC15] transition-colors">
                                 <Eye className="size-4" />
                              </button>
                           </div>
                        </td>
                        <td className="px-6 py-4">
                           {key.status === 'active' ? (
                              <div className="flex items-center gap-1.5 text-emerald-600 text-sm font-bold">
                                 <CheckCircle2 className="size-4" /> Active
                              </div>
                           ) : (
                              <div className="flex flex-col gap-0.5">
                                 <div className="flex items-center gap-1.5 text-yellow-600 text-sm font-bold">
                                    <AlertCircle className="size-4" /> Warning
                                 </div>
                                 {key.note && <span className="text-xs text-yellow-700">{key.note}</span>}
                              </div>
                           )}
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-500 font-medium">
                           {key.lastUsed}
                        </td>
                        <td className="px-6 py-4 text-right">
                           <button className="p-2 text-slate-400 hover:text-slate-900 transition-colors rounded-lg hover:bg-slate-100 opacity-0 group-hover:opacity-100 focus:opacity-100">
                              <MoreVertical className="size-5" />
                           </button>
                        </td>
                     </tr>
                  ))}
               </tbody>
            </table>
         </div>
      </div>
    </div>
  )
}
