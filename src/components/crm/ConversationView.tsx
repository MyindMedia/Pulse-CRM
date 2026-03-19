'use client'

import { useState } from 'react';
import { GhlMessage } from '@/types/ghl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface ConversationViewProps {
  initialMessages: GhlMessage[];
  contactId: string;
}

export function ConversationView({ initialMessages, contactId }: ConversationViewProps) {
  const [messages, setMessages] = useState<GhlMessage[]>(initialMessages);
  const [newMessage, setNewMessage] = useState('');

  const handleSendMessage = async () => {
    if (!newMessage.trim()) return;

    const response = await fetch('/api/ghl/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId, message: newMessage, type: 'SMS' }),
    });

    if (response.ok) {
      const sentMessage = await response.json();
      setMessages([...messages, sentMessage]);
      setNewMessage('');
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
            <div className={`p-2 rounded-lg ${message.direction === 'outbound' ? 'bg-[#FEFCE8]0 text-white' : 'bg-gray-200'}`}>
              {message.content}
            </div>
          </div>
        ))}
      </div>
      <div className="p-4 border-t">
        <div className="flex space-x-2">
          <Textarea
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
          />
          <Button onClick={handleSendMessage}>Send</Button>
        </div>
      </div>
    </div>
  );
}
