import Sidebar from '@/components/command-center/Sidebar'
import TopBar from '@/components/command-center/TopBar'

export default function CommandCenterLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full bg-gradient-to-br from-[#eef2f5] to-[#f0f4f0] font-sans text-slate-700 overflow-hidden">
      {/* Floating Sidebar */}
      <Sidebar />
      
      <div className="flex flex-col flex-1 h-full overflow-hidden">
        {/* Topbar */}
        <TopBar />
        
        {/* Main Content Area */}
        <main className="flex-1 overflow-auto p-4 lg:p-8">
          <div className="mx-auto max-w-[1440px] h-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
