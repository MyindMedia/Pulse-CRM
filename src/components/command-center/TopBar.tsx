'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bell } from 'lucide-react'
import { cn } from '@/lib/utils'

const navLinks = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/advisors', label: 'Advisors' },
  { href: '/fleet', label: 'Agent Fleet' },
  { href: '/api-vault', label: 'API Vault' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/admin-settings', label: 'Settings' },
]

export default function TopBar() {
  const pathname = usePathname()

  return (
    <header className="flex items-center justify-between px-6 py-4 mt-4 mx-4 lg:mx-8 bg-white/80 backdrop-blur-xl rounded-full border border-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)] z-40">
      {/* Left: Brand */}
      <div className="flex items-center gap-3">
        <img src="/Pulse Logo.png" alt="Pulse CRM" className="h-8 w-auto object-contain" />

      </div>

      {/* Center Navigation Links */}
      <nav className="hidden lg:flex items-center gap-1">
        {navLinks.map((link) => {
          const isActive = pathname.startsWith(link.href)
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                'px-4 py-2 rounded-full text-sm font-medium transition-colors',
                isActive
                  ? 'bg-[#FACC15] text-slate-900 shadow-md'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              )}
            >
              {link.label}
            </Link>
          )
        })}
      </nav>

      {/* Right: User actions */}
      <div className="flex items-center gap-4">
        <button className="relative flex items-center justify-center size-10 rounded-full hover:bg-slate-100 text-slate-500 transition-colors">
          <span className="absolute top-2 right-2.5 size-2 rounded-full bg-yellow-400 border-2 border-white"></span>
          <Bell className="size-5" />
        </button>
        <button className="flex items-center justify-center size-10 rounded-full border-2 border-white shadow-sm bg-yellow-100 text-[#EAB308] font-semibold text-sm">
          A
        </button>
      </div>
    </header>
  )
}
