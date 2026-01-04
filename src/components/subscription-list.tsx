"use client";

import { useState } from "react";
import { SubscriptionCard } from "./subscription-card";
import type { Subscription } from "@/lib/db/schema";

interface SubscriptionListProps {
  initialSubscriptions: Subscription[];
}

export function SubscriptionList({
  initialSubscriptions,
}: SubscriptionListProps) {
  const [subscriptions, setSubscriptions] =
    useState<Subscription[]>(initialSubscriptions);

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/subscriptions/${id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setSubscriptions((prev) => prev.filter((s) => s.id !== id));
      }
    } catch (error) {
      console.error("Failed to delete subscription:", error);
    }
  };

  if (subscriptions.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-8 h-8 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
            />
          </svg>
        </div>
        <h3 className="font-medium mb-1">No subscriptions detected yet</h3>
        <p className="text-sm text-muted-foreground">
          We&apos;ll notify you when we find subscription or trial emails in
          your inbox.
        </p>
      </div>
    );
  }

  const activeSubscriptions = subscriptions.filter(
    (s) => s.status === "active" || s.status === "expiring_soon"
  );
  const pastSubscriptions = subscriptions.filter(
    (s) => s.status === "expired" || s.status === "cancelled"
  );

  return (
    <div className="space-y-8">
      {activeSubscriptions.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-4">Active</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {activeSubscriptions.map((subscription) => (
              <SubscriptionCard
                key={subscription.id}
                subscription={subscription}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </div>
      )}

      {pastSubscriptions.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-4 text-muted-foreground">
            Past
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {pastSubscriptions.map((subscription) => (
              <SubscriptionCard
                key={subscription.id}
                subscription={subscription}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
