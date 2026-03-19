'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Search,
  Share2,
  Upload,
  Star,
  Plus,
  Grid,
  Calendar,
  Send,
  AlertCircle
} from 'lucide-react'
import { cn } from '@/lib/utils'

const icons = [
  { icon: Search, label: 'Search', href: '/search' },
  { icon: Share2, label: 'Share', href: '/share' },
  { icon: Upload, label: 'Upload', href: '/upload' },
  { icon: Star, label: 'Favorites', href: '/favorites' },
  { icon: Plus, label: 'Add', href: '/add', fill: true }, // Action button
  { icon: Grid, label: 'Grid', href: '/grid' },
  { icon: Calendar, label: 'Calendar', href: '/calendar' },
  { icon: Send, label: 'Send', href: '/send' },
  { icon: AlertCircle, label: 'Alerts', href: '/alerts' },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <div className="flex flex-col items-center py-6 ml-6 my-6 w-[72px] bg-white rounded-full shadow-[0_20px_40px_-10px_rgba(30,41,59,0.06)] border border-white/60 z-50 h-[calc(100vh-3rem)]">
      <div className="flex flex-col gap-3 w-full px-3 flex-1 overflow-y-auto no-scrollbar items-center">
        {icons.map((item, i) => {
          const Icon = item.icon
          const isActive = pathname.startsWith(item.href) && item.href !== '/dashboard'
          
          if (item.fill) {
            return (
              <div key={item.label} className="my-2">
                <button
                  className="flex items-center justify-center size-12 rounded-full bg-[#FACC15] text-slate-900 shadow-lg shadow-yellow-600/20 hover:scale-105 transition-transform"
                  title={item.label}
                >
                  <Icon className="size-5" />
                </button>
              </div>
            )
          }

          return (
            <Link
              key={item.label}
              href={item.href}
              title={item.label}
              className={cn(
                'flex items-center justify-center size-11 rounded-full transition-all duration-200 group',
                isActive
                  ? 'bg-slate-900 text-white shadow-md'
                  : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
              )}
            >
              <Icon className={cn("size-[22px]", isActive ? "stroke-[2px]" : "stroke-[1.5px]")} />
            </Link>
          )
        })}
      </div>
    </div>
  )
}
