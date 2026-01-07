"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FeedbackDialog } from "./feedback-dialog";
import type { Subscription } from "@/lib/db/schema";

interface SubscriptionCardProps {
  subscription: Subscription;
  onDelete: (id: string) => void;
}

export function SubscriptionCard({
  subscription,
  onDelete,
}: SubscriptionCardProps) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const statusColors = {
    active: "bg-green-100 text-green-800",
    expiring_soon: "bg-yellow-100 text-yellow-800",
    expired: "bg-red-100 text-red-800",
    cancelled: "bg-gray-100 text-gray-800",
  };

  const typeColors = {
    trial: "bg-blue-100 text-blue-800",
    subscription: "bg-purple-100 text-purple-800",
  };

  const formatDate = (date: Date | null) => {
    if (!date) return "Unknown";
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const daysUntil = (date: Date | null) => {
    if (!date) return null;
    const now = new Date();
    const end = new Date(date);
    const diffTime = end.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const days = daysUntil(subscription.endDate);

  return (
    <>
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <CardTitle className="text-lg">{subscription.serviceName}</CardTitle>
          <div className="flex gap-2">
            <Badge variant="secondary" className={typeColors[subscription.type]}>
              {subscription.type}
            </Badge>
            <Badge
              variant="secondary"
              className={statusColors[subscription.status]}
            >
              {subscription.status.replace("_", " ")}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Detected</span>
            <span>{formatDate(subscription.detectedDate)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>{subscription.type === "trial" ? "Ends" : "Renews"}</span>
            <span>
              {formatDate(subscription.endDate)}
              {days !== null && days > 0 && (
                <span className="ml-1 text-xs">({days} days)</span>
              )}
            </span>
          </div>
          {subscription.emailSubject && (
            <p className="text-xs text-muted-foreground truncate pt-2 border-t">
              {subscription.emailSubject}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFeedbackOpen(true)}
          >
            Report Issue
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
            onClick={() => onDelete(subscription.id)}
          >
            Remove Reminder
          </Button>
        </div>
      </CardContent>
    </Card>

    <FeedbackDialog
      subscription={subscription}
      open={feedbackOpen}
      onOpenChange={setFeedbackOpen}
      onDelete={onDelete}
    />
    </>
  );
}
