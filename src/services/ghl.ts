import { ghlApi } from '@/lib/ghl/adapter';
import { GhlContact, GhlOpportunity, GhlConversation, GhlMessage } from '@/types/ghl';

export class GhlService {
  async getContacts(locationId: string): Promise<GhlContact[]> {
    const response = await ghlApi.getContacts(locationId);
    // Assuming the response has a 'contacts' property which is an array
    return response.contacts;
  }

  async getOpportunities(locationId: string): Promise<GhlOpportunity[]> {
    const response = await ghlApi.getOpportunities(locationId);
    // Assuming the response has an 'opportunities' property which is an array
    return response.opportunities;
  }

  async sendMessage(params: { contactId: string; type: 'Email' | 'SMS'; message?: string; html?: string; subject?: string; }) {
    return ghlApi.sendMessage(params);
  }

  async getConversation(contactId: string): Promise<GhlConversation> {
    const response = await ghlApi.getConversation(contactId);
    // Assuming the first result is the one we want
    return response.conversations[0];
  }

  async getMessages(conversationId: string): Promise<GhlMessage[]> {
    const response = await ghlApi.getMessages(conversationId);
    return response.messages;
  }
}

export const ghlService = new GhlService();
