'use client'

import { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { mockPipeline, type PipelineColumnDef } from '@/lib/mock-data';
import { PipelineColumn } from './PipelineColumn';

export function PipelineBoard() {
  const [stages, setStages] = useState<PipelineColumnDef[]>(mockPipeline);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over) return;

    if (active.id !== over.id) {
      setStages((items) => {
        const oldStageIndex = items.findIndex((stage) => stage.opportunities.some(opp => opp.id === active.id));
        const newStageIndex = items.findIndex((stage) => stage.id === over.id || stage.opportunities.some(opp => opp.id === over.id));

        if (oldStageIndex === -1 || newStageIndex === -1) {
          return items; // Should not happen
        }

        const oldStage = items[oldStageIndex];
        const newStage = items[newStageIndex];

        const oldOppIndex = oldStage.opportunities.findIndex(opp => opp.id === active.id);
        
        const [movedOpp] = oldStage.opportunities.splice(oldOppIndex, 1);
        movedOpp.stageId = newStage.id;

        const overIsStage = newStage.id === over.id;

        if(overIsStage) {
            newStage.opportunities.push(movedOpp);
        } else {
            const newOppIndex = newStage.opportunities.findIndex(opp => opp.id === over.id);
            newStage.opportunities.splice(newOppIndex, 0, movedOpp);
        }
        
        const newItems = [...items];
        newItems[oldStageIndex] = { ...oldStage };
        newItems[newStageIndex] = { ...newStage };

        return newItems;
      });
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="flex overflow-x-auto p-4">
        <SortableContext items={stages.map((stage) => stage.id)} strategy={verticalListSortingStrategy}>
          {stages.map((stage) => (
            <PipelineColumn key={stage.id} stage={stage} />
          ))}
        </SortableContext>
      </div>
    </DndContext>
  );
}
