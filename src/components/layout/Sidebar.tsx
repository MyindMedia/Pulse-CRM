'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Search,
  LayoutDashboard,
  Users,
  KanbanSquare,
  Calendar,
  Receipt,
  MessageCircle,
  Bot,
} from 'lucide-react'

import { cn } from '@/lib/utils'

const actions = [
  { href: '#search', label: 'Search', icon: Search },
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/crm', label: 'CRM', icon: Users },
  { href: '/pipeline', label: 'Pipeline', icon: KanbanSquare },
  { href: '/bookings', label: 'Bookings', icon: Calendar },
  { href: '/invoices', label: 'Invoices', icon: Receipt },
  { href: '/messages', label: 'Messages', icon: MessageCircle },
  { href: '/agents', label: 'AI Agents', icon: Bot },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <div className="flex flex-col items-start py-6 gap-6 w-[72px] hover:w-[200px] bg-card text-muted-foreground rounded-3xl shadow-[0_20px_40px_-10px_rgba(30,41,59,0.05)] border-none transition-all duration-300 ease-in-out group overflow-hidden z-50 ml-6 my-6 h-[calc(100vh-3rem)]">
      <div className="flex flex-col gap-4 w-full px-4">
        {actions.map((action) => {
          const Icon = action.icon
          const isActive = action.href === '/' ? pathname === '/' : pathname.startsWith(action.href) && action.href !== '#search'

          
          return (
            <Link
              key={action.label}
              href={action.href}
              className={cn(
                'flex items-center gap-3 h-10 w-full rounded-full transition-all duration-200',
                isActive
                  ? 'bg-primary/10 text-primary font-semibold'
                  : 'hover:bg-muted hover:text-foreground'
              )}
            >
              <div className="flex items-center justify-center min-w-[40px] size-10">
                <Icon className="size-[20px] stroke-[2px]" />
              </div>
              <span className="opacity-0 group-hover:opacity-100 whitespace-nowrap overflow-hidden transition-opacity duration-300 text-sm font-medium">
                {action.label}
              </span>
            </Link>
          )
        })}
      </div>
      
      {/* Bottom accent icon */}
      <div className="mt-4 pt-4 border-t border-white/10 w-full px-4 flex items-center gap-3">
         <button className="flex items-center justify-center min-w-[40px] size-10 rounded-full bg-gradient-to-tr from-rose-400 to-orange-400 text-white shadow-lg flex-shrink-0 hover:scale-105 transition-transform">
           <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
         </button>
         <span className="opacity-0 group-hover:opacity-100 whitespace-nowrap overflow-hidden transition-opacity duration-300 text-sm font-medium text-white">
           Upgrade
         </span>
      </div>
    </div>
  )
}
