export default function PageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex-1 overflow-y-auto p-8">{children}</main>
  )
}
