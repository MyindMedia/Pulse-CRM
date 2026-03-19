import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { mockInvoices } from '@/lib/mock-data'

const recentPaid = mockInvoices
  .filter((inv) => inv.status === 'paid' && inv.paidAt)
  .sort((a, b) => new Date(b.paidAt!).getTime() - new Date(a.paidAt!).getTime())
  .slice(0, 5)

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(cents / 100)
}

export function RecentSales() {
  return (
    <div className="space-y-8">
      {recentPaid.map((inv) => {
        const initials = inv.clientName
          .split(' ')
          .map((n) => n[0])
          .join('')
          .toUpperCase()
        return (
          <div key={inv.id} className="flex items-center">
            <Avatar className="h-9 w-9">
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="ml-4 space-y-1">
              <p className="text-sm font-medium leading-none">{inv.clientName}</p>
              <p className="text-sm text-muted-foreground">{inv.projectTitle}</p>
            </div>
            <div className="ml-auto font-medium">+{formatCurrency(inv.amountCents)}</div>
          </div>
        )
      })}
    </div>
  )
}
