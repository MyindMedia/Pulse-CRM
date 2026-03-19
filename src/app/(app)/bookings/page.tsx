'use client'

import { useState, useMemo, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Plus, CalendarDays, CheckCircle2, Clock, AlertTriangle } from 'lucide-react'
import { motion } from 'framer-motion'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SessionCard } from '@/components/bookings/session-card'
import { BookingDialog } from '@/components/bookings/booking-dialog'
import { mockSessions, type Session, type SessionStatus } from '@/lib/mock-data'

function getWeekDays(baseDate: Date): Date[] {
  const start = new Date(baseDate)
  const day = start.getDay()
  start.setDate(start.getDate() - day + 1) // Monday
  const days: Date[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    days.push(d)
  }
  return days
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function formatDayHeader(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function BookingsContent() {
  const searchParams = useSearchParams()
  const view = searchParams.get('view') || 'overview'

  const [sessions, setSessions] = useState<Session[]>(mockSessions)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)

  const today = new Date()
  const weekDays = useMemo(() => getWeekDays(today), [])

  const upcoming = sessions.filter(
    (s) => new Date(s.startsAt) >= today && s.status !== 'cancelled'
  ).length
  const confirmed = sessions.filter((s) => s.status === 'confirmed').length
  const completed = sessions.filter((s) => s.status === 'completed').length
  const noShows = sessions.filter((s) => s.status === 'no_show').length

  function handleAddSession(data: Omit<Session, 'id'>) {
    const newSession: Session = {
      ...data,
      id: `s${Date.now()}`,
    }
    setSessions((prev) => [...prev, newSession])
  }

  function handleEditSession(data: Omit<Session, 'id'>) {
    if (!selectedSession) return
    setSessions((prev) =>
      prev.map((s) => (s.id === selectedSession.id ? { ...s, ...data } : s))
    )
    setSelectedSession(null)
  }

  // Group sessions by status for list view
  const upcomingSessions = sessions
    .filter((s) => ['requested', 'confirmed'].includes(s.status))
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())

  const pastSessions = sessions
    .filter((s) => ['completed', 'no_show', 'cancelled'].includes(s.status))
    .sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime())

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24 }}
      className="space-y-6"
    >
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bookings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Schedule and manage studio sessions.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="size-4 mr-1.5" />
          Book Session
        </Button>
      </div>

      {/* Summary Cards */}
      {view === 'overview' && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card size="sm">
            <CardHeader className="flex flex-row items-center justify-between pb-1">
              <CardTitle className="text-sm font-medium text-muted-foreground">Upcoming</CardTitle>
              <CalendarDays className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums">{upcoming}</p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader className="flex flex-row items-center justify-between pb-1">
              <CardTitle className="text-sm font-medium text-muted-foreground">Confirmed</CardTitle>
              <Clock className="size-4 text-[#FACC15]" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums">{confirmed}</p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader className="flex flex-row items-center justify-between pb-1">
              <CardTitle className="text-sm font-medium text-muted-foreground">Completed</CardTitle>
              <CheckCircle2 className="size-4 text-emerald-400" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums">{completed}</p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader className="flex flex-row items-center justify-between pb-1">
              <CardTitle className="text-sm font-medium text-muted-foreground">No-Shows</CardTitle>
              <AlertTriangle className="size-4 text-red-400" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums">{noShows}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main Content Area */}
      {view === 'list' ? (
        <div className="space-y-6">
          <div>
            <h3 className="font-medium mb-3">Upcoming</h3>
            {upcomingSessions.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <CalendarDays className="size-10 mb-3 opacity-40" />
                  <p className="text-sm">No upcoming sessions</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => setDialogOpen(true)}>
                    Book a Session
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {upcomingSessions.map((s) => (
                  <SessionCard key={s.id} session={s} onClick={setSelectedSession} />
                ))}
              </div>
            )}
          </div>
          <div>
            <h3 className="font-medium mb-3">Past</h3>
            {pastSessions.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <CheckCircle2 className="size-10 mb-3 opacity-40" />
                  <p className="text-sm">No past sessions</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {pastSessions.map((s) => (
                  <SessionCard key={s.id} session={s} onClick={setSelectedSession} />
                ))}
              </div>
            )}
          </div>
        </div>
      ) : view === 'board' ? (
        <div className="grid grid-cols-7 gap-3">
          {weekDays.map((day) => {
            const daySessions = sessions.filter((s) =>
              isSameDay(new Date(s.startsAt), day)
            )
            const isToday = isSameDay(day, today)
            return (
              <div key={day.toISOString()} className="space-y-2">
                <div
                  className={`text-xs font-medium text-center py-2 rounded-lg ${
                    isToday
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground'
                  }`}
                >
                  {formatDayHeader(day)}
                </div>
                <div className="space-y-2 min-h-[100px]">
                  {daySessions.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground/40 text-center pt-4">
                      No sessions
                    </p>
                  ) : (
                    daySessions.map((s) => (
                      <SessionCard
                        key={s.id}
                        session={s}
                        onClick={setSelectedSession}
                      />
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <Tabs defaultValue="week">
          <TabsList>
            <TabsTrigger value="week">Week View</TabsTrigger>
            <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
            <TabsTrigger value="past">Past</TabsTrigger>
          </TabsList>

          <TabsContent value="week">
            <div className="grid grid-cols-7 gap-3">
              {weekDays.map((day) => {
                const daySessions = sessions.filter((s) =>
                  isSameDay(new Date(s.startsAt), day)
                )
                const isToday = isSameDay(day, today)
                return (
                  <div key={day.toISOString()} className="space-y-2">
                    <div
                      className={`text-xs font-medium text-center py-2 rounded-lg ${
                        isToday
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {formatDayHeader(day)}
                    </div>
                    <div className="space-y-2 min-h-[100px]">
                      {daySessions.length === 0 ? (
                        <p className="text-[10px] text-muted-foreground/40 text-center pt-4">
                          No sessions
                        </p>
                      ) : (
                        daySessions.map((s) => (
                          <SessionCard
                            key={s.id}
                            session={s}
                            onClick={setSelectedSession}
                          />
                        ))
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </TabsContent>

          <TabsContent value="upcoming">
            {upcomingSessions.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <CalendarDays className="size-10 mb-3 opacity-40" />
                  <p className="text-sm">No upcoming sessions</p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => setDialogOpen(true)}>
                    Book a Session
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {upcomingSessions.map((s) => (
                  <SessionCard key={s.id} session={s} onClick={setSelectedSession} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="past">
            {pastSessions.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <CheckCircle2 className="size-10 mb-3 opacity-40" />
                  <p className="text-sm">No past sessions</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {pastSessions.map((s) => (
                  <SessionCard key={s.id} session={s} onClick={setSelectedSession} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}

      {/* Book Session Dialog */}
      <BookingDialog open={dialogOpen} onOpenChange={setDialogOpen} onSave={handleAddSession} />

      {/* Edit Session Dialog */}
      {selectedSession && (
        <BookingDialog
          open={!!selectedSession}
          onOpenChange={(open) => {
            if (!open) setSelectedSession(null)
          }}
          session={selectedSession}
          onSave={handleEditSession}
        />
      )}
    </motion.div>
  )
}

export default function BookingsPage() {
  return (
    <Suspense fallback={<div>Loading bookings...</div>}>
      <BookingsContent />
    </Suspense>
  )
}
