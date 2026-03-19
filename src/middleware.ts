import { type NextRequest, NextResponse } from 'next/server'

export async function middleware(request: NextRequest) {
  // Convex handles auth client-side via its React provider.
  // Middleware is reserved for route protection once auth is wired up.
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
