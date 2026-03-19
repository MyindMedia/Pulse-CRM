import { Save } from 'lucide-react'

export default function GeneralSettings() {
  return (
    <div className="flex flex-col gap-8">
       <div>
          <h2 className="text-xl font-bold text-slate-900 mb-1">General Profile</h2>
          <p className="text-sm text-slate-500">Update your account information and preferences.</p>
       </div>

       <div className="flex flex-col gap-6 max-w-2xl border-t border-slate-100 pt-6">
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
             <div className="flex flex-col gap-2">
                <label className="text-sm font-bold text-slate-700">First Name</label>
                <input type="text" defaultValue="John" className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#FACC15]/20 focus:border-[#FACC15]" />
             </div>
             <div className="flex flex-col gap-2">
                <label className="text-sm font-bold text-slate-700">Last Name</label>
                <input type="text" defaultValue="Doe" className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#FACC15]/20 focus:border-[#FACC15]" />
             </div>
          </div>

          <div className="flex flex-col gap-2">
             <label className="text-sm font-bold text-slate-700">Email Address</label>
             <input type="email" defaultValue="john.doe@acmecorp.com" disabled className="px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-slate-500 cursor-not-allowed" />
             <p className="text-xs text-slate-400">Contact IT support to change your assigned enterprise email.</p>
          </div>
          
          <div className="flex flex-col gap-2">
             <label className="text-sm font-bold text-slate-700">Job Title / Role</label>
             <input type="text" defaultValue="Director of Operations" className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#FACC15]/20 focus:border-[#FACC15]" />
          </div>

          <div className="flex items-center gap-4 pt-4 border-t border-slate-100">
             <button className="flex justify-center items-center gap-2 bg-[#FACC15] hover:bg-[#EAB308] text-slate-900 px-6 py-2.5 rounded-xl font-bold shadow-[0_8px_16px_-4px_rgba(37,99,235,0.4)] transition-all hover:-translate-y-0.5">
                <Save className="size-4" /> Save Profile
             </button>
             <button className="px-6 py-2.5 font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-xl transition-colors">
                Cancel
             </button>
          </div>

       </div>
    </div>
  )
}
