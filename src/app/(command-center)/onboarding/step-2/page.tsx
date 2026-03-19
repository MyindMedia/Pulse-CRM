import Link from 'next/link'

const providers = [
  { name: 'OpenAI', logo: '🟢', description: 'GPT-4 and GPT-3.5 models' },
  { name: 'Anthropic', logo: '🟣', description: 'Claude 3 Opus, Sonnet, Haiku' },
  { name: 'Clarifai', logo: '🔵', description: 'Computer vision and multi-modal' },
  { name: 'Google Gemini', logo: '✨', description: 'Gemini Pro and Ultra models' },
]

export default function OnboardingStep2() {
  return (
    <div className="flex items-center justify-center w-full min-h-[calc(100vh-140px)] py-12">
      <div className="bg-white rounded-[32px] shadow-[0_20px_40px_-10px_rgba(30,41,59,0.08)] border border-slate-100 p-12 w-full max-w-3xl flex flex-col">
        {/* Step Indicator */}
        <div className="flex items-center gap-2 mb-8">
          <div className="flex-1 h-2 bg-[#FACC15] rounded-full"></div>
          <div className="flex-1 h-2 bg-[#FACC15] rounded-full"></div>
          <div className="flex-1 h-2 bg-slate-100 rounded-full"></div>
        </div>
        
        <div className="mb-8">
          <h2 className="text-sm font-bold text-[#FACC15] uppercase tracking-wider mb-2">Step 2 of 3</h2>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Connect Your Fleet's Brains</h1>
          <p className="text-slate-500">Provide API keys for the Foundation Models your agents will use.</p>
        </div>

        <div className="flex flex-col gap-4 mb-10">
          {providers.map((provider) => (
            <div key={provider.name} className="flex flex-col sm:flex-row sm:items-center gap-4 p-5 rounded-2xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-4 min-w-[200px]">
                <div className="flex items-center justify-center size-10 rounded-xl bg-white shadow-sm border border-slate-200 text-xl">
                  {provider.logo}
                </div>
                <div>
                  <h3 className="font-bold text-slate-800">{provider.name}</h3>
                  <p className="text-xs text-slate-500">{provider.description}</p>
                </div>
              </div>

              <div className="flex-1">
                <input 
                  type="password" 
                  placeholder="sk-..." 
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#FACC15]/20 focus:border-[#FACC15] transition-colors bg-white text-slate-800 placeholder:text-slate-400 font-mono text-sm"
                />
              </div>

              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-slate-500">Connect</span>
                <button className="relative inline-flex h-6 w-11 items-center rounded-full bg-slate-200 transition-colors focus:outline-none focus:ring-2 focus:ring-[#FACC15] focus:ring-offset-2 hover:bg-slate-300">
                  <span className="inline-block h-4 w-4 transform rounded-full bg-white transition-transform translate-x-1" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between mt-auto">
          <Link 
            href="/onboarding/step-1"
            className="py-3 px-6 text-slate-500 hover:text-slate-900 font-semibold transition-colors"
          >
            Back
          </Link>
          <div className="flex items-center gap-3">
            <Link 
              href="/onboarding/step-3"
              className="py-3 px-6 text-slate-500 hover:text-slate-900 font-semibold transition-colors"
            >
              Skip for now
            </Link>
            <Link 
              href="/onboarding/step-3"
              className="py-3 px-8 bg-[#FACC15] hover:bg-[#EAB308] text-slate-900 rounded-xl font-bold shadow-[0_8px_16px_-4px_rgba(37,99,235,0.4)] transition-all hover:shadow-[0_8px_20px_-4px_rgba(37,99,235,0.6)] hover:-translate-y-0.5"
            >
              Save & Continue
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
