import { GHL_API_KEY, GHL_AGENCY_API_KEY } from '@/config';

const GHL_V1_BASE = 'https://rest.gohighlevel.com/v1';
const GHL_V2_BASE = 'https://services.leadconnectorhq.com';

interface GhlApiRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
  version?: 'v1' | 'v2';
}

export interface CreateSubAccountParams {
  name: string;
  email: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  timezone?: string;
  snapshotId?: string;
}

export interface GhlSubAccountResponse {
  id: string;
  name: string;
  email: string;
  companyId: string;
}

export class GhlApiAdapter {
  private apiKey: string;
  private agencyApiKey: string;

  constructor(apiKey: string, agencyApiKey: string) {
    this.apiKey = apiKey;
    this.agencyApiKey = agencyApiKey;
  }

  private async request<T>({ method, path, body, version = 'v1' }: GhlApiRequest): Promise<T> {
    const baseUrl = version === 'v2' ? GHL_V2_BASE : GHL_V1_BASE;
    const token = version === 'v2' ? this.agencyApiKey : this.apiKey;
    const url = `${baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      Version: '2021-07-28',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`GHL API Error (${response.status}): ${errorBody}`);
    }

    return response.json();
  }

  async createSubAccount(params: CreateSubAccountParams): Promise<GhlSubAccountResponse> {
    return this.request<GhlSubAccountResponse>({
      method: 'POST',
      path: '/locations',
      version: 'v2',
      body: {
        name: params.name,
        email: params.email,
        phone: params.phone,
        address: params.address,
        city: params.city,
        state: params.state,
        country: params.country ?? 'US',
        postalCode: params.postalCode,
        timezone: params.timezone ?? 'America/New_York',
        ...(params.snapshotId && { snapshotId: params.snapshotId }),
      },
    });
  }

  async getSubAccount(locationId: string) {
    return this.request<GhlSubAccountResponse>({
      method: 'GET',
      path: `/locations/${locationId}`,
      version: 'v2',
    });
  }

  async getContacts(locationId: string) {
    return this.request<any>({
      method: 'GET',
      path: `/locations/${locationId}/contacts`,
    });
  }

  async getOpportunities(locationId: string) {
    return this.request<any>({
      method: 'GET',
      path: `/locations/${locationId}/opportunities`,
    });
  }

  async sendMessage(params: { contactId: string; type: 'Email' | 'SMS'; message?: string; html?: string; subject?: string; }) {
    return this.request<any>({ 
      method: 'POST',
      path: '/conversations/messages',
      version: 'v2',
      body: params,
    });
  }

  async getConversation(contactId: string) {
    return this.request<any>({ 
      method: 'GET',
      path: `/conversations/search?contactId=${contactId}`,
      version: 'v2',
    });
  }

  async getMessages(conversationId: string) {
    return this.request<any>({ 
      method: 'GET',
      path: `/conversations/${conversationId}/messages`,
      version: 'v2',
    });
  }
}

export const ghlApi = new GhlApiAdapter(GHL_API_KEY, GHL_AGENCY_API_KEY);
