'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Activity, ShieldAlert, Cpu, CheckCircle2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// Mock data for AI Control Plane UI until Convex queries are fully integrated
// In production: useQuery(api.agents.getActiveRuns)
const mockActiveRuns = [
  {
    _id: "run1",
    agentName: "Booking Agent",
    status: "paused_for_approval",
    input: "User requested to book a session for John Doe next Tuesday.",
    startedAt: new Date().toISOString(),
  },
  {
    _id: "run2",
    agentName: "Pipeline Agent",
    status: "completed",
    input: "Analyze stagnant deals in the Qualified stage.",
    startedAt: new Date(Date.now() - 3600000).toISOString(),
    completedAt: new Date(Date.now() - 3500000).toISOString(),
  }
]

// In production: useQuery(api.agents.getPendingActions)
const mockPendingActions = [
  {
    _id: "act1",
    agentRunId: "run1",
    toolName: "scheduleSession",
    tier: "B",
    status: "pending_approval",
    toolArgs: {
      clientName: "John Doe",
      proposedStartTime: "2026-03-17T10:00:00Z",
      serviceType: "Recording Session"
    },
    proposedAt: new Date().toISOString(),
  }
]

export default function AgentsPage() {
  const [activeRuns] = useState(mockActiveRuns)
  const [pendingActions, setPendingActions] = useState(mockPendingActions)

  const handleApprove = (id: string) => {
    // In production: ctx.runMutation(api.agents.approveAction, { actionId: id })
    setPendingActions(prev => prev.filter(action => action._id !== id))
  }

  const handleReject = (id: string) => {
    // In production: ctx.runMutation(api.agents.rejectAction, { actionId: id })
    setPendingActions(prev => prev.filter(action => action._id !== id))
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24 }}
      className="space-y-6"
    >
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI Control Plane</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor autonomous agent runs, review proposed actions, and manage guardrails.
          </p>
        </div>
        <Button onClick={() => alert("Simulation triggered")}>
          <Cpu className="size-4 mr-2" />
          Test Agent Run
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card size="sm">
          <CardHeader className="flex flex-row items-center justify-between pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Agent Runs
            </CardTitle>
            <Activity className="size-4 text-[#EAB308]" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">{activeRuns.filter(r => r.status !== "completed").length}</p>
          </CardContent>
        </Card>
        <Card size="sm" className="border-amber-500/50 bg-amber-500/5">
          <CardHeader className="flex flex-row items-center justify-between pb-1">
            <CardTitle className="text-sm font-medium text-amber-600 dark:text-amber-400">
              Pending Approvals (Tier B)
            </CardTitle>
            <ShieldAlert className="size-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
              {pendingActions.length}
            </p>
            <p className="text-xs text-amber-600/80 dark:text-amber-400/80 mt-1">Requires human review</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader className="flex flex-row items-center justify-between pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Automated Actions (30d)
            </CardTitle>
            <CheckCircle2 className="size-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">142</p>
            <p className="text-xs text-emerald-500 mt-1">94% automated resolution</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Pending Approvals */}
        <Card>
          <CardHeader>
            <CardTitle>Pending Approvals</CardTitle>
            <CardDescription>Actions paused awaiting admin confirmation</CardDescription>
          </CardHeader>
          <CardContent>
            {pendingActions.length === 0 ? (
               <div className="text-sm text-muted-foreground text-center py-8">
                 No pending actions.
               </div>
            ) : (
              <div className="space-y-4">
                {pendingActions.map(action => (
                  <div key={action._id} className="border rounded-lg p-4 space-y-3 bg-card relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-amber-500"></div>
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20">
                        {action.toolName}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(action.proposedAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="text-sm bg-muted/50 p-2 rounded whitespace-pre-wrap font-mono text-xs">
                      {JSON.stringify(action.toolArgs, null, 2)}
                    </div>
                    <div className="flex gap-2 justify-end pt-2">
                      <Button variant="outline" size="sm" onClick={() => handleReject(action._id)}>
                        Reject
                      </Button>
                      <Button size="sm" onClick={() => handleApprove(action._id)}>
                        Approve Action
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Global Runs Log */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Agent Runs</CardTitle>
            <CardDescription>Log of all autonomous operations</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeRuns.map(run => (
                  <TableRow key={run._id}>
                    <TableCell className="font-medium">{run.agentName}</TableCell>
                    <TableCell>
                      <Badge 
                        variant="secondary" 
                        className={
                          run.status === 'completed' ? 'bg-emerald-500/10 text-emerald-500' :
                          run.status === 'paused_for_approval' ? 'bg-amber-500/10 text-amber-500' : ''
                        }
                      >
                       {run.status.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(run.startedAt).toLocaleTimeString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

    </motion.div>
  )
}
