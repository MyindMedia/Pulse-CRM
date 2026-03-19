import fetch, { RequestInit } from 'node-fetch';

const GHL_API_BASE_URL = 'https://services.leadconnectorhq.com';

interface GhlApiClientOptions {
  accessToken: string;
  locationId: string;
}

export class GhlApiClient {
  private accessToken: string;
  private locationId: string;

  constructor(options: GhlApiClientOptions) {
    this.accessToken = options.accessToken;
    this.locationId = options.locationId;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${GHL_API_BASE_URL}${path}`;
    const headers = {
      ...options.headers,
      Authorization: `Bearer ${this.accessToken}`,
      Version: '2021-07-28',
      'Content-Type': 'application/json',
    };

    const response = await fetch(url, { ...options, headers });

    if (!response.ok) {
      const error: any = await response.json();
      throw new Error(`GHL API Error: ${error.message || 'Unknown error'}`);
    }

    return response.json() as Promise<T>;
  }

  // Add GHL API methods here (e.g., getContacts, createOpportunity, etc.)
}
