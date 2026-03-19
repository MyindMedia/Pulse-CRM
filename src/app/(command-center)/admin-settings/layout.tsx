import Link from 'next/link'
import { User, ShieldAlert, Building2, HelpCircle } from 'lucide-react'

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-8 w-full min-h-full animate-in fade-in duration-500 pb-10">
      
      {/* Header */}
      <div className="flex flex-col gap-2">
         <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Organization Settings</h1>
         <p className="text-slate-500 font-medium">Manage your personal profile, audit logs, and affiliated companies.</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-8 items-start">
         
         {/* Left Navigation Sidebar */}
         <aside className="w-full lg:w-64 shrink-0 flex flex-col gap-1">
            <Link href="/admin-settings" className="flex items-center gap-3 px-4 py-3 rounded-xl bg-yellow-50 text-[#EAB308] font-bold transition-colors">
               <User className="size-5" /> General Profile
            </Link>
            <Link href="/admin-settings/audit-log" className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-600 font-medium hover:bg-slate-50 hover:text-slate-900 transition-colors">
               <ShieldAlert className="size-5" /> Audit Log & Tickets
            </Link>
            <Link href="/admin-settings/companies" className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-600 font-medium hover:bg-slate-50 hover:text-slate-900 transition-colors">
               <Building2 className="size-5" /> Company Portfolio
            </Link>
            
            <div className="mt-8 pt-6 border-t border-slate-200">
               <Link href="/help-center" className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-600 font-medium hover:bg-slate-50 hover:text-slate-900 transition-colors">
                  <HelpCircle className="size-5" /> Help Center
               </Link>
            </div>
         </aside>

         {/* Main Content Area */}
         <main className="flex-1 bg-white rounded-[32px] shadow-[0_20px_40px_-10px_rgba(30,41,59,0.06)] border border-slate-100 p-8 min-h-[500px]">
            {children}
         </main>
         
      </div>
    </div>
  )
}
