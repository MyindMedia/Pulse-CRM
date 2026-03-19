'use client';

import { TopStats } from '@/components/dashboard/bento/TopStats'
import { InteractionHistory } from '@/components/dashboard/bento/InteractionHistory'
import { TasksSchedule } from '@/components/dashboard/bento/TasksSchedule'
import { StageFunnel } from '@/components/dashboard/bento/StageFunnel'
import { CustomerProfile } from '@/components/dashboard/bento/CustomerProfile'
import { DetailedInformation } from '@/components/dashboard/bento/DetailedInformation'
import { OnboardingJourney } from '@/components/dashboard/bento/OnboardingJourney'

export default function DashboardPage() {
  return (
    <div className="w-full h-full max-w-[1600px] mx-auto overflow-y-auto pr-2 pb-10">
      <TopStats />

      {/* Main Bento Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        
        {/* Left Side (3 Columns wide) */}
        <div className="xl:col-span-3 flex flex-col gap-6">
          <div className="w-full">
            <InteractionHistory />
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1">
            <div className="h-full">
              <TasksSchedule />
            </div>
            <div className="h-full">
              <StageFunnel />
            </div>
          </div>
        </div>

        {/* Right Side (1 Column wide) */}
        <div className="xl:col-span-1 flex flex-col gap-6">
           <OnboardingJourney />
           <CustomerProfile />
           <DetailedInformation />
        </div>

      </div>
    </div>
  );
}
