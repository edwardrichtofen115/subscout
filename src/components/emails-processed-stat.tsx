"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HelpCircle } from "lucide-react";

interface EmailsProcessedStatProps {
  count: number;
}

export function EmailsProcessedStat({ count }: EmailsProcessedStatProps) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <p className="text-sm text-muted-foreground">Emails Processed (24h)</p>
        <Tooltip>
          <TooltipTrigger asChild>
            <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            Emails scanned for subscription and trial information in the last 24
            hours
          </TooltipContent>
        </Tooltip>
      </div>
      <p className="text-2xl font-bold">{count}</p>
    </div>
  );
}
