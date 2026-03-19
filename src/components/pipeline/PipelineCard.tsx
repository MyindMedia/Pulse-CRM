'use client'

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Opportunity } from '@/lib/mock-data';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface PipelineCardProps {
  opportunity: Opportunity;
}

export function PipelineCard({ opportunity }: PipelineCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: opportunity.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{opportunity.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p>{opportunity.client.name}</p>
          <p>${opportunity.value}</p>
        </CardContent>
      </Card>
    </div>
  );
}
