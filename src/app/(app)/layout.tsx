import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'
import PageWrapper from '@/components/layout/PageWrapper'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex h-screen overflow-hidden">
      {/* Floating Action Sidebar */}
      <div className="absolute left-6 top-1/2 -translate-y-1/2 z-50">
        <Sidebar />
      </div>
      
      {/* Main Content Area */}
      <div className="flex flex-col flex-1 h-full pl-[100px] overflow-y-auto">
        <Header />
        <PageWrapper>{children}</PageWrapper>
      </div>
    </div>
  )
}
