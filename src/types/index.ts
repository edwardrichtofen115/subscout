export interface EmailClassification {
  is_subscription: boolean;
  confidence: number;
  service_name: string | null;
  type: "trial" | "subscription" | null;
  duration_days: number | null;
  end_date: string | null;
  reasoning: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload: {
    headers: Array<{ name: string; value: string }>;
    body?: { data?: string };
    parts?: Array<{
      mimeType: string;
      body?: { data?: string };
    }>;
  };
  internalDate: string;
}

export interface GmailNotification {
  message: {
    data: string;
    messageId: string;
    publishTime: string;
  };
  subscription: string;
}

export interface GmailPushData {
  emailAddress: string;
  historyId: string;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description: string;
  start: { date: string };
  end: { date: string };
}

export type FeedbackReason =
  | "not_subscription"
  | "wrong_service_name"
  | "wrong_dates"
  | "wrong_type"
  | "other";

export const FEEDBACK_REASON_LABELS: Record<FeedbackReason, string> = {
  not_subscription: "This is not a subscription/trial",
  wrong_service_name: "Wrong service name",
  wrong_dates: "Incorrect dates",
  wrong_type: "Wrong type (trial vs subscription)",
  other: "Other issue",
};
