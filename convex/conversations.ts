import { v } from "convex/values";
import { action } from "./_generated/server";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-04-15";
const GHL_VERSION_CONTACTS = "2021-07-28";

function ghlHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${process.env.GHL_AGENCY_API_KEY}`,
    Version: GHL_VERSION,
  };
}

// ─── Search Conversations ───

export const searchConversations = action({
  args: {
    locationId: v.string(),
    contactId: v.optional(v.string()),
    query: v.optional(v.string()),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (_, args) => {
    const params = new URLSearchParams({ locationId: args.locationId });
    if (args.contactId) params.set("contactId", args.contactId);
    if (args.query) params.set("query", args.query);
    if (args.status) params.set("status", args.status);
    if (args.limit) params.set("limit", String(args.limit));

    const response = await fetch(
      `${GHL_BASE}/conversations/search?${params.toString()}`,
      { method: "GET", headers: ghlHeaders() }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      return { conversations: [], total: 0, error: `GHL ${response.status}: ${errorBody}` };
    }

    const data = (await response.json()) as Record<string, any>;
    return {
      conversations: data.conversations ?? [],
      total: data.total ?? 0,
    };
  },
});

// ─── Get Messages for a Conversation ───

export const getMessages = action({
  args: {
    conversationId: v.string(),
    lastMessageId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (_, args) => {
    const params = new URLSearchParams({ type: "1" });
    if (args.lastMessageId) params.set("lastMessageId", args.lastMessageId);
    if (args.limit) params.set("limit", String(args.limit));

    const response = await fetch(
      `${GHL_BASE}/conversations/${args.conversationId}/messages?${params.toString()}`,
      { method: "GET", headers: ghlHeaders() }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      return { messages: [], nextPage: false, error: `GHL ${response.status}: ${errorBody}` };
    }

    const data = (await response.json()) as Record<string, any>;
    return {
      messages: data.messages ?? [],
      nextPage: data.nextPage ?? false,
      lastMessageId: data.lastMessageId ?? null,
    };
  },
});

// ─── Send Message ───

export const sendMessage = action({
  args: {
    contactId: v.string(),
    type: v.string(), // SMS, Email, WhatsApp, etc.
    message: v.string(),
    subject: v.optional(v.string()),
    html: v.optional(v.string()),
    conversationId: v.optional(v.string()),
    emailFrom: v.optional(v.string()),
  },
  handler: async (_, args) => {
    const body: Record<string, any> = {
      type: args.type,
      contactId: args.contactId,
      message: args.message,
    };

    if (args.subject) body.subject = args.subject;
    if (args.html) body.html = args.html;
    if (args.conversationId) body.conversationId = args.conversationId;
    if (args.emailFrom) body.emailFrom = args.emailFrom;

    const response = await fetch(`${GHL_BASE}/conversations/messages`, {
      method: "POST",
      headers: ghlHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return { success: false, error: `GHL ${response.status}: ${errorBody}` };
    }

    const data = (await response.json()) as Record<string, any>;
    return {
      success: true,
      conversationId: data.conversationId,
      messageId: data.messageId,
      msg: data.msg,
    };
  },
});

// ─── Create Conversation ───

export const createConversation = action({
  args: {
    locationId: v.string(),
    contactId: v.string(),
  },
  handler: async (_, args) => {
    const response = await fetch(`${GHL_BASE}/conversations/`, {
      method: "POST",
      headers: ghlHeaders(),
      body: JSON.stringify({
        locationId: args.locationId,
        contactId: args.contactId,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return { success: false, error: `GHL ${response.status}: ${errorBody}` };
    }

    const data = (await response.json()) as Record<string, any>;
    return {
      success: data.success ?? true,
      conversation: data.conversation ?? null,
    };
  },
});

// ─── Search Contacts in a Location ───

export const searchContacts = action({
  args: {
    locationId: v.string(),
    query: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (_, args) => {
    const params = new URLSearchParams({ locationId: args.locationId });
    if (args.query) params.set("query", args.query);
    if (args.limit) params.set("limit", String(args.limit));

    const response = await fetch(
      `${GHL_BASE}/contacts/?${params.toString()}`,
      { method: "GET", headers: ghlHeaders() }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      return { contacts: [], error: `GHL ${response.status}: ${errorBody}` };
    }

    const data = (await response.json()) as Record<string, any>;
    return {
      contacts: data.contacts ?? [],
    };
  },
});

// ─── Create Contact in a Location ───

export const createContact = action({
  args: {
    locationId: v.string(),
    firstName: v.string(),
    lastName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
  },
  handler: async (_, args) => {
    const response = await fetch(`${GHL_BASE}/contacts/`, {
      method: "POST",
      headers: ghlHeaders(),
      body: JSON.stringify({
        locationId: args.locationId,
        firstName: args.firstName,
        lastName: args.lastName,
        email: args.email,
        phone: args.phone,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return { success: false, error: `GHL ${response.status}: ${errorBody}` };
    }

    const data = (await response.json()) as Record<string, any>;
    return {
      success: true,
      contact: data.contact ?? null,
    };
  },
});

// ─── Get Contact Details ───

export const getContact = action({
  args: { contactId: v.string() },
  handler: async (_, args) => {
    const response = await fetch(`${GHL_BASE}/contacts/${args.contactId}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${process.env.GHL_AGENCY_API_KEY}`,
        Version: GHL_VERSION_CONTACTS,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return { contact: null, error: `GHL ${response.status}: ${errorBody}` };
    }

    const data = (await response.json()) as Record<string, any>;
    return { contact: data.contact ?? null };
  },
});

// ─── Contact Tags ───

export const addTags = action({
  args: {
    contactId: v.string(),
    tags: v.array(v.string()),
  },
  handler: async (_, args) => {
    const response = await fetch(
      `${GHL_BASE}/contacts/${args.contactId}/tags`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${process.env.GHL_AGENCY_API_KEY}`,
          Version: GHL_VERSION_CONTACTS,
        },
        body: JSON.stringify({ tags: args.tags }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      return { success: false, error: `GHL ${response.status}: ${errorBody}` };
    }

    const data = (await response.json()) as Record<string, any>;
    return { success: true, tags: data.tags ?? [] };
  },
});

export const removeTags = action({
  args: {
    contactId: v.string(),
    tags: v.array(v.string()),
  },
  handler: async (_, args) => {
    const response = await fetch(
      `${GHL_BASE}/contacts/${args.contactId}/tags`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${process.env.GHL_AGENCY_API_KEY}`,
          Version: GHL_VERSION_CONTACTS,
        },
        body: JSON.stringify({ tags: args.tags }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      return { success: false, error: `GHL ${response.status}: ${errorBody}` };
    }

    return { success: true };
  },
});

// ─── Contact Notes ───

export const getNotes = action({
  args: { contactId: v.string() },
  handler: async (_, args) => {
    const response = await fetch(
      `${GHL_BASE}/contacts/${args.contactId}/notes`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${process.env.GHL_AGENCY_API_KEY}`,
          Version: GHL_VERSION_CONTACTS,
        },
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      return { notes: [], error: `GHL ${response.status}: ${errorBody}` };
    }

    const data = (await response.json()) as Record<string, any>;
    return { notes: data.notes ?? [] };
  },
});

export const addNote = action({
  args: {
    contactId: v.string(),
    body: v.string(),
  },
  handler: async (_, args) => {
    const response = await fetch(
      `${GHL_BASE}/contacts/${args.contactId}/notes`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${process.env.GHL_AGENCY_API_KEY}`,
          Version: GHL_VERSION_CONTACTS,
        },
        body: JSON.stringify({ body: args.body }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      return { success: false, error: `GHL ${response.status}: ${errorBody}` };
    }

    const data = (await response.json()) as Record<string, any>;
    return { success: true, note: data.note ?? data };
  },
});

// ─── Email sending with subject + HTML ───

export const sendEmail = action({
  args: {
    contactId: v.string(),
    subject: v.string(),
    html: v.string(),
    emailFrom: v.optional(v.string()),
    conversationId: v.optional(v.string()),
  },
  handler: async (_, args) => {
    const body: Record<string, any> = {
      type: "Email",
      contactId: args.contactId,
      subject: args.subject,
      html: args.html,
      message: args.html.replace(/<[^>]*>/g, ""), // plain text fallback
    };

    if (args.emailFrom) body.emailFrom = args.emailFrom;
    if (args.conversationId) body.conversationId = args.conversationId;

    const response = await fetch(`${GHL_BASE}/conversations/messages`, {
      method: "POST",
      headers: ghlHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return { success: false, error: `GHL ${response.status}: ${errorBody}` };
    }

    const data = (await response.json()) as Record<string, any>;
    return {
      success: true,
      conversationId: data.conversationId,
      messageId: data.messageId,
    };
  },
});
