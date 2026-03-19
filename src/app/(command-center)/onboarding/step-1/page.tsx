import Link from 'next/link'

export default function OnboardingStep1() {
  return (
    <div className="flex items-center justify-center w-full h-[calc(100vh-140px)]">
      <div className="bg-white rounded-[32px] shadow-[0_20px_40px_-10px_rgba(30,41,59,0.08)] border border-slate-100 p-12 w-full max-w-2xl flex flex-col">
        {/* Step Indicator */}
        <div className="flex items-center gap-2 mb-8">
          <div className="flex-1 h-2 bg-[#FACC15] rounded-full"></div>
          <div className="flex-1 h-2 bg-slate-100 rounded-full"></div>
          <div className="flex-1 h-2 bg-slate-100 rounded-full"></div>
        </div>
        
        <div className="mb-8">
          <h2 className="text-sm font-bold text-[#FACC15] uppercase tracking-wider mb-2">Step 1 of 3</h2>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Company Setup</h1>
          <p className="text-slate-500">Tell us about your organization to help us calibrate your agent fleet.</p>
        </div>

        <form className="flex flex-col gap-6">
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">Company Name</label>
            <input 
              type="text" 
              placeholder="E.g. Acme Corporation" 
              className="w-full px-5 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#FACC15]/20 focus:border-[#FACC15] transition-colors bg-white text-slate-800 placeholder:text-slate-400 font-medium"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">Industry</label>
            <select className="w-full px-5 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#FACC15]/20 focus:border-[#FACC15] transition-colors bg-white text-slate-800 font-medium appearance-none">
              <option value="">Select your industry...</option>
              <option value="tech">Technology & Software</option>
              <option value="finance">Financial Services</option>
              <option value="healthcare">Healthcare</option>
              <option value="retail">Retail & E-commerce</option>
              <option value="agency">Marketing Agency</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">Company Mission</label>
            <textarea 
              rows={4}
              placeholder="What is your ultimate goal? E.g. We build the world's best..." 
              className="w-full px-5 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#FACC15]/20 focus:border-[#FACC15] transition-colors bg-white text-slate-800 placeholder:text-slate-400 font-medium resize-none"
            />
          </div>

          <div className="flex items-center justify-end mt-4">
            <Link 
              href="/onboarding/step-2"
              className="py-3 px-8 bg-[#FACC15] hover:bg-[#EAB308] text-slate-900 rounded-xl font-bold shadow-[0_8px_16px_-4px_rgba(37,99,235,0.4)] transition-all hover:shadow-[0_8px_20px_-4px_rgba(37,99,235,0.6)] hover:-translate-y-0.5"
            >
              Next Step
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
