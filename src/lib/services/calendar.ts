import { google, calendar_v3 } from "googleapis";

export class CalendarService {
  private calendar: calendar_v3.Calendar;

  constructor(accessToken: string) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    this.calendar = google.calendar({ version: "v3", auth });
  }

  async createReminder(
    serviceName: string,
    type: "trial" | "subscription",
    endDate: Date,
    reminderDaysBefore: number
  ): Promise<string | null> {
    const reminderDate = new Date(endDate);
    reminderDate.setDate(reminderDate.getDate() - reminderDaysBefore);

    if (reminderDate < new Date()) {
      return null;
    }

    const dateStr = reminderDate.toISOString().split("T")[0];
    const endDateStr = endDate.toISOString().split("T")[0];

    const event = {
      summary: `Review: ${serviceName} ${type}`,
      description: `Your ${serviceName} ${type} ${type === "trial" ? "ends" : "renews"} on ${endDateStr}.\n\nReview and decide whether to continue or cancel.\n\nCreated by SubScout`,
      start: {
        date: dateStr,
      },
      end: {
        date: dateStr,
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: "popup", minutes: 60 * 9 },
          { method: "email", minutes: 60 * 24 },
        ],
      },
    };

    try {
      const response = await this.calendar.events.insert({
        calendarId: "primary",
        requestBody: event,
      });

      return response.data.id || null;
    } catch (error) {
      console.error("Error creating calendar event:", error);
      return null;
    }
  }

  async updateReminder(
    eventId: string,
    serviceName: string,
    type: "trial" | "subscription",
    endDate: Date,
    reminderDaysBefore: number
  ): Promise<boolean> {
    const reminderDate = new Date(endDate);
    reminderDate.setDate(reminderDate.getDate() - reminderDaysBefore);

    const dateStr = reminderDate.toISOString().split("T")[0];
    const endDateStr = endDate.toISOString().split("T")[0];

    try {
      await this.calendar.events.update({
        calendarId: "primary",
        eventId,
        requestBody: {
          summary: `Review: ${serviceName} ${type}`,
          description: `Your ${serviceName} ${type} ${type === "trial" ? "ends" : "renews"} on ${endDateStr}.\n\nReview and decide whether to continue or cancel.\n\nCreated by SubScout`,
          start: { date: dateStr },
          end: { date: dateStr },
        },
      });

      return true;
    } catch (error) {
      console.error("Error updating calendar event:", error);
      return false;
    }
  }

  async deleteReminder(eventId: string): Promise<boolean> {
    try {
      await this.calendar.events.delete({
        calendarId: "primary",
        eventId,
      });

      return true;
    } catch (error) {
      console.error("Error deleting calendar event:", error);
      return false;
    }
  }
}
