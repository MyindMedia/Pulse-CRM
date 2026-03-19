import { Search, Book, MessageSquare, Zap, Shield, FileText, ArrowRight, Video } from 'lucide-react'

const categories = [
  { id: 1, name: 'Getting Started', icon: <Zap className="size-5" />, desc: 'Onboarding guides and platform basics.', color: 'text-yellow-600', bg: 'bg-yellow-100' },
  { id: 2, name: 'Agent Configuration', icon: <Book className="size-5" />, desc: 'Setting up personas, skills, and orchestrators.', color: 'text-[#FACC15]', bg: 'bg-yellow-100' },
  { id: 3, name: 'Billing & Plans', icon: <FileText className="size-5" />, desc: 'Understanding your invoice and usage limits.', color: 'text-emerald-600', bg: 'bg-emerald-100' },
  { id: 4, name: 'API & Security', icon: <Shield className="size-5" />, desc: 'Vault management, encryption, and keys.', color: 'text-purple-600', bg: 'bg-purple-100' },
]

const popularArticles = [
  'How to assign a new skill to an existing agent',
  'Interpreting the Lead Advisor Orchestration Log',
  'Setting up fallback LLM providers in the API Vault',
  'Understanding budget constraints and pausing execution',
  'Creating a custom Persona prompt for outbound sales',
]

export default function HelpCenter() {
  return (
    <div className="flex flex-col gap-10 w-full min-h-full animate-in fade-in duration-500 pb-16">
      
      {/* Hero Section */}
      <div className="flex flex-col items-center justify-center py-16 px-6 bg-gradient-to-b from-yellow-50 to-white rounded-[32px] border border-yellow-100 shadow-sm text-center relative overflow-hidden">
         <div className="absolute top-0 right-0 w-64 h-64 bg-yellow-400 opacity-5 blur-[100px] rounded-full"></div>
         <div className="absolute bottom-0 left-0 w-80 h-80 bg-emerald-400 opacity-5 blur-[100px] rounded-full"></div>

         <h1 className="text-4xl lg:text-5xl font-extrabold text-slate-900 tracking-tight z-10">How can we help?</h1>
         <p className="text-lg text-slate-600 mt-4 max-w-2xl z-10">Search our knowledge base or browse categories below to find answers.</p>
         
         <div className="relative mt-8 w-full max-w-2xl z-10">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-slate-400" />
            <input type="text" placeholder="Search for articles, guides, and tutorials..." className="w-full pl-12 pr-6 py-4 bg-white border-2 border-slate-200 rounded-2xl text-base shadow-[0_8px_30px_rgb(0,0,0,0.04)] focus:outline-none focus:ring-4 focus:ring-[#FACC15]/10 focus:border-[#FACC15] transition-all" />
         </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
         
         {/* Main Categories & Popular */}
         <div className="lg:col-span-2 flex flex-col gap-10">
            
            <section>
               <h2 className="text-xl font-bold text-slate-900 mb-6 tracking-tight">Browse Topics</h2>
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {categories.map((cat) => (
                     <a href="#" key={cat.id} className="group p-6 rounded-2xl border border-slate-200 bg-white hover:border-[#FACC15] hover:shadow-[0_10px_30px_-10px_rgba(37,99,235,0.2)] transition-all flex flex-col gap-4">
                        <div className={`size-10 rounded-xl flex items-center justify-center ${cat.bg} ${cat.color}`}>
                           {cat.icon}
                        </div>
                        <div>
                           <h3 className="font-bold text-slate-900 group-hover:text-[#FACC15] transition-colors uppercase tracking-tight text-sm">{cat.name}</h3>
                           <p className="text-slate-500 text-sm mt-1">{cat.desc}</p>
                        </div>
                     </a>
                  ))}
               </div>
            </section>

            <section>
               <h2 className="text-xl font-bold text-slate-900 mb-6 tracking-tight">Popular Articles</h2>
               <div className="flex flex-col gap-3">
                  {popularArticles.map((article, idx) => (
                     <a href="#" key={idx} className="flex items-center justify-between p-4 rounded-xl border border-slate-100 bg-slate-50 hover:bg-white hover:border-yellow-200 hover:shadow-sm transition-all group">
                        <div className="flex items-center gap-3">
                           <FileText className="size-4 text-slate-400 group-hover:text-[#FACC15] transition-colors" />
                           <span className="font-medium text-slate-700 group-hover:text-yellow-900 transition-colors">{article}</span>
                        </div>
                        <ArrowRight className="size-4 text-slate-300 group-hover:text-[#FACC15] transition-colors -translate-x-2 opacity-0 group-hover:opacity-100 group-hover:translate-x-0" />
                     </a>
                  ))}
               </div>
            </section>

         </div>

         {/* Sidebar Promos */}
         <div className="flex flex-col gap-6">
            
            <div className="bg-slate-900 rounded-[24px] p-8 text-white shadow-[0_20px_40px_-10px_rgba(30,41,59,0.2)] border border-slate-800 flex flex-col gap-4">
               <div className="p-3 bg-white/10 rounded-xl w-fit">
                  <MessageSquare className="size-5 text-yellow-400" />
               </div>
               <div>
                  <h3 className="text-xl font-bold mb-2">Still need help?</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">Our enterprise support team is available 24/7 to assist with technical integration and agent configurations.</p>
               </div>
               <button className="mt-2 bg-[#FACC15] hover:bg-yellow-500 text-white w-full py-3 rounded-xl font-bold transition-colors">
                  Contact Support
               </button>
            </div>

            <div className="bg-white rounded-[24px] p-8 border border-slate-200 flex flex-col gap-4">
               <div className="p-3 bg-indigo-50 rounded-xl w-fit">
                  <Video className="size-5 text-indigo-600" />
               </div>
               <div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2 tracking-tight">Video Tutorials</h3>
                  <p className="text-slate-500 text-sm leading-relaxed mb-4">Watch guided walkthroughs on deploying your first AI fleet and setting up advisors.</p>
               </div>
               <a href="#" className="font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-2 text-sm">
                  View Library <ArrowRight className="size-4" />
               </a>
            </div>

         </div>
      </div>

    </div>
  )
}
