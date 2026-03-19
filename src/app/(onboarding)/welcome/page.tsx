'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { CheckCircle2, ArrowRight, LayoutDashboard, Users, Kanban, CalendarDays } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Suspense } from 'react'

function WelcomeContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const orgName = searchParams.get('name') ?? 'Your Organization'
  const locationId = searchParams.get('locationId')

  const features = [
    { icon: LayoutDashboard, label: 'Dashboard', description: 'KPIs, revenue, and pipeline overview' },
    { icon: Users, label: 'CRM', description: 'Manage clients, contacts, and relationships' },
    { icon: Kanban, label: 'Pipeline', description: 'Track deals from inquiry to delivery' },
    { icon: CalendarDays, label: 'Bookings', description: 'Schedule and manage sessions' },
  ]

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-lg space-y-8 text-center"
      >
        {/* Success icon */}
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
          className="flex justify-center"
        >
          <div className="inline-flex items-center justify-center size-16 rounded-full bg-emerald-500/15">
            <CheckCircle2 className="size-8 text-emerald-400" />
          </div>
        </motion.div>

        {/* Welcome message */}
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Welcome to Pulse!</h1>
          <p className="text-lg text-muted-foreground">
            <span className="text-foreground font-medium">{orgName}</span> is ready to go.
          </p>
          {locationId && (
            <p className="text-xs text-muted-foreground">
              GHL sub-account connected
            </p>
          )}
        </div>

        {/* Feature cards */}
        <div className="grid grid-cols-2 gap-3 text-left">
          {features.map((feature, i) => {
            const Icon = feature.icon
            return (
              <motion.div
                key={feature.label}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.1 }}
              >
                <Card className="h-full">
                  <CardContent className="pt-4 pb-4 space-y-1.5">
                    <Icon className="size-5 text-primary" />
                    <p className="text-sm font-medium">{feature.label}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{feature.description}</p>
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}
        </div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
        >
          <Button
            size="lg"
            className="w-full"
            onClick={() => router.push('/')}
          >
            Go to Dashboard
            <ArrowRight className="ml-2 size-4" />
          </Button>
        </motion.div>
      </motion.div>
    </div>
  )
}

export default function WelcomePage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center">
        <div className="size-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <WelcomeContent />
    </Suspense>
  )
}
