'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Bell, Mail, Bot } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { Suspense } from 'react'

const views = [
  { id: 'overview', label: 'Overview' },
  { id: 'list', label: 'List View' },
  { id: 'board', label: 'Board View' },
]

function HeaderContent() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentView = searchParams.get('view') || 'overview'

  const showViewSwitcher = ['/pipeline', '/bookings', '/invoices'].some(p => pathname.startsWith(p))

  return (
    <header className="flex items-center justify-between px-8 py-6 w-full max-w-[1600px] mx-auto z-40">
      {/* Logo Area */}
      <div className="flex items-center gap-3">
        <img src="/Pulse Logo.png" alt="Pulse CRM" className="h-8 w-auto object-contain cursor-pointer" />
      </div>

      {/* Center Navigation - View Switcher */}
      {showViewSwitcher ? (
        <nav className="hidden lg:flex items-center gap-1 bg-card/80 backdrop-blur-xl px-2 py-1.5 rounded-full border border-border/50 shadow-sm relative z-40">
          {views.map((view) => {
            const active = currentView === view.id
            return (
              <Link
                key={view.id}
                href={`${pathname}?view=${view.id}`}
                className={cn(
                  'px-4 py-2 rounded-full text-sm font-medium transition-all duration-200',
                  active
                    ? 'bg-primary text-primary-foreground shadow-md'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                )}
              >
                {view.label}
              </Link>
            )
          })}
        </nav>
      ) : (
        <div className="hidden lg:flex" /> // Empty placeholder to keep flex-between spacing
      )}

      {/* Right User Area */}
      <div className="flex items-center gap-3">
        <button className="flex items-center justify-center size-10 rounded-full bg-card/60 backdrop-blur-sm border border-border/50 text-muted-foreground hover:bg-card hover:text-foreground transition-colors shadow-sm">
          <Mail className="size-4" />
        </button>
        <button className="flex items-center justify-center size-10 rounded-full bg-card/60 backdrop-blur-sm border border-border/50 text-muted-foreground hover:bg-card hover:text-foreground transition-colors shadow-sm">
          <Bell className="size-4" />
        </button>
        <button className="flex items-center justify-center size-10 rounded-full bg-card/60 backdrop-blur-sm border border-border/50 text-muted-foreground hover:bg-card hover:text-foreground transition-colors shadow-sm">
          <Bot className="size-4" />
        </button>
        <div className="pl-2 border-l border-border/50">
          <Avatar className="size-10 shadow-sm">
            <AvatarFallback className="text-xs bg-primary/10 text-primary font-medium">MS</AvatarFallback>
          </Avatar>
        </div>
      </div>
    </header>
  )
}

export default function Header() {
  return (
    <Suspense fallback={<header className="flex items-center justify-between px-8 py-6 w-full max-w-[1600px] mx-auto z-40"><div className="flex items-center gap-3"><img src="/Pulse Logo.png" alt="Pulse CRM" className="h-8 w-auto object-contain cursor-pointer" /></div></header>}>
      <HeaderContent />
    </Suspense>
  )
}
