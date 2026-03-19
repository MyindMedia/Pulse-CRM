import Link from 'next/link'

export default function LoginScreen() {
  return (
    <div className="flex items-center justify-center w-full h-[calc(100vh-140px)]">
      <div className="bg-white rounded-[24px] shadow-[0_20px_40px_-10px_rgba(30,41,59,0.08)] border border-slate-100 p-10 w-full max-w-md flex flex-col items-center">
        {/* Logo */}
        <img src="/Pulse Logo.png" alt="Pulse CRM" className="h-14 w-auto object-contain mb-6" />
        
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Welcome Back</h2>
        <p className="text-slate-500 text-sm mb-8 text-center">Sign in to orchestrate your AI agent fleet.</p>

        <form className="w-full flex flex-col gap-5">
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-700">Email Address</label>
            <input 
              type="email" 
              placeholder="name@company.com" 
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#FACC15]/20 focus:border-[#FACC15] transition-colors bg-white text-slate-800 placeholder:text-slate-400"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-slate-700">Password</label>
              <Link href="/forgot-password" className="text-sm font-medium text-[#FACC15] hover:text-[#EAB308]">
                Forgot Password?
              </Link>
            </div>
            <input 
              type="password" 
              placeholder="••••••••" 
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#FACC15]/20 focus:border-[#FACC15] transition-colors bg-white text-slate-800 placeholder:text-slate-400"
            />
          </div>

          <button 
            type="button"
            className="w-full mt-2 py-3 px-4 bg-[#FACC15] hover:bg-[#EAB308] text-slate-900 rounded-xl font-semibold shadow-[0_8px_16px_-4px_rgba(37,99,235,0.4)] transition-all hover:shadow-[0_8px_20px_-4px_rgba(37,99,235,0.6)] hover:-translate-y-0.5"
          >
            Sign In
          </button>
        </form>

        <p className="mt-8 text-sm text-slate-500">
          Don't have an account?{' '}
          <Link href="/register" className="font-semibold text-[#FACC15] hover:text-[#EAB308] transition-colors">
            Create Account
          </Link>
        </p>
      </div>
    </div>
  )
}
