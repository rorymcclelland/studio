"use client";

import { Button } from "@/components/ui/button";
import { ToastCard, useToast } from "@/components/ui/toast";

/** Static toasts to look at, and buttons that raise real ones. */
export function ToastDemo() {
  const toast = useToast();
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2">
        <ToastCard item={{ id: -1, tone: "good", message: "Sample: Tagline approved. The agent is finishing the run." }} />
        <ToastCard
          item={{ id: -2, tone: "attention", message: "Sample: Couldn't record the decision. Nothing was changed; try again." }}
        />
        <ToastCard item={{ id: -3, tone: "neutral", message: "Sample: Brand kit saved." }} />
      </div>
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="quiet"
          size="sm"
          onClick={() => toast({ tone: "good", message: "Sample: Decision recorded." })}
        >
          Show a sample result toast
        </Button>
        <Button
          type="button"
          variant="quiet"
          size="sm"
          onClick={() =>
            toast({ tone: "attention", message: "Sample: Couldn't save. Nothing was changed; try again." })
          }
        >
          Show a sample error toast
        </Button>
      </div>
    </div>
  );
}
