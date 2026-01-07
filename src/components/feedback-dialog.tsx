"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Subscription } from "@/lib/db/schema";
import { FEEDBACK_REASON_LABELS, type FeedbackReason } from "@/types";

interface FeedbackDialogProps {
  subscription: Subscription;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FeedbackDialog({
  subscription,
  open,
  onOpenChange,
}: FeedbackDialogProps) {
  const [reason, setReason] = useState<FeedbackReason | "">("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<
    "idle" | "success" | "error"
  >("idle");

  const handleSubmit = async () => {
    if (!reason) return;

    setIsSubmitting(true);
    setSubmitStatus("idle");

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscriptionId: subscription.id,
          reason,
          description,
        }),
      });

      if (res.ok) {
        setSubmitStatus("success");
        setTimeout(() => {
          setReason("");
          setDescription("");
          setSubmitStatus("idle");
          onOpenChange(false);
        }, 1500);
      } else {
        setSubmitStatus("error");
      }
    } catch (error) {
      console.error("Failed to submit feedback:", error);
      setSubmitStatus("error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setReason("");
      setDescription("");
      setSubmitStatus("idle");
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Report Issue</DialogTitle>
          <DialogDescription>
            Help us improve by reporting incorrect classifications for{" "}
            <span className="font-medium">{subscription.serviceName}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>What&apos;s wrong?</Label>
            <div className="space-y-2">
              {(Object.keys(FEEDBACK_REASON_LABELS) as FeedbackReason[]).map(
                (key) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="reason"
                      value={key}
                      checked={reason === key}
                      onChange={(e) =>
                        setReason(e.target.value as FeedbackReason)
                      }
                      className="h-4 w-4"
                    />
                    <span className="text-sm">
                      {FEEDBACK_REASON_LABELS[key]}
                    </span>
                  </label>
                )
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Additional details (optional)</Label>
            <Textarea
              id="description"
              placeholder="Tell us more about the issue..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          {submitStatus === "success" && (
            <p className="text-sm text-green-600">
              Thank you! Your feedback has been submitted.
            </p>
          )}
          {submitStatus === "error" && (
            <p className="text-sm text-red-600">
              Failed to submit feedback. Please try again.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!reason || isSubmitting}>
            {isSubmitting ? "Submitting..." : "Submit Feedback"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
