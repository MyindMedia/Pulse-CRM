import Link from 'next/link'

export default function OnboardingStep3() {
  return (
    <div className="flex items-center justify-center w-full h-[calc(100vh-140px)]">
      <div className="bg-white rounded-[32px] shadow-[0_20px_40px_-10px_rgba(30,41,59,0.08)] border border-slate-100 p-12 w-full max-w-2xl flex flex-col items-center">
        {/* Step Indicator */}
        <div className="flex items-center gap-2 mb-8 w-full">
          <div className="flex-1 h-2 bg-[#FACC15] rounded-full"></div>
          <div className="flex-1 h-2 bg-[#FACC15] rounded-full"></div>
          <div className="flex-1 h-2 bg-[#FACC15] rounded-full"></div>
        </div>
        
        <div className="mb-8 w-full">
          <h2 className="text-sm font-bold text-[#FACC15] uppercase tracking-wider mb-2">Step 3 of 3</h2>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Hire Your First Agent</h1>
          <p className="text-slate-500">Initialize your first AI worker to begin orchestrating tasks.</p>
        </div>

        <div className="w-full flex justify-center mb-8">
           <div className="size-24 rounded-full bg-slate-100 border-4 border-white shadow-lg flex items-center justify-center text-4xl">
              🤖
           </div>
        </div>

        <form className="w-full flex flex-col gap-5">
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">Agent Name</label>
            <input 
              type="text" 
              placeholder="E.g. Aria, Opto, or DataBot" 
              className="w-full px-5 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#FACC15]/20 focus:border-[#FACC15] transition-colors bg-white text-slate-800 placeholder:text-slate-400 font-medium"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">Agent Role</label>
            <select className="w-full px-5 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#FACC15]/20 focus:border-[#FACC15] transition-colors bg-white text-slate-800 font-medium appearance-none">
              <optgroup label="Advisors (Management)">
                <option value="ceo">Chief Executive Officer (Lead)</option>
                <option value="cmo">Chief Marketing Officer</option>
                <option value="cto">Chief Technology Officer</option>
              </optgroup>
              <optgroup label="Workers (Execution)">
                <option value="engineer">Software Engineer</option>
                <option value="researcher">Research Analyst</option>
                <option value="support">Customer Support Rep</option>
                <option value="sales">Sales Development Rep</option>
              </optgroup>
            </select>
          </div>

          <button 
            type="button"
            className="w-full mt-4 py-3 px-4 bg-white border-2 border-slate-200 hover:border-[#FACC15] hover:text-[#EAB308] text-slate-700 rounded-xl font-bold transition-all shadow-sm"
          >
            + Add Another Agent
          </button>
        </form>

        <div className="w-full pt-8 mt-8 border-t border-slate-100 flex flex-col items-center gap-4">
          <Link 
            href="/dashboard"
            className="w-full text-center py-4 px-8 bg-[#FACC15] hover:bg-[#EAB308] text-slate-900 rounded-xl font-bold shadow-[0_8px_16px_-4px_rgba(37,99,235,0.4)] transition-all hover:shadow-[0_8px_20px_-4px_rgba(37,99,235,0.6)] hover:-translate-y-0.5 text-lg"
          >
            Initialize Fleet & Finish Setup
          </Link>
          <Link 
            href="/dashboard"
            className="text-sm font-semibold text-slate-400 hover:text-slate-600 transition-colors"
          >
            Skip and go to dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
