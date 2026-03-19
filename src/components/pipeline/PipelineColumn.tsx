'use client'

import { SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { PipelineColumnDef } from '@/lib/mock-data';
import { PipelineCard } from './PipelineCard';

interface PipelineColumnProps {
  stage: PipelineColumnDef;
}

export function PipelineColumn({ stage }: PipelineColumnProps) {
  const { setNodeRef } = useSortable({
    id: stage.id,
  });

  return (
    <div ref={setNodeRef} className="w-80 bg-gray-100 rounded-lg p-4 mr-4">
      <h2 className="text-lg font-bold mb-4">{stage.title}</h2>
      <SortableContext items={stage.opportunities.map((opp) => opp.id)}>
        {stage.opportunities.map((opportunity) => (
          <PipelineCard key={opportunity.id} opportunity={opportunity} />
        ))}
      </SortableContext>
    </div>
  );
}
