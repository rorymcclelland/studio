// C8-2 on the campaign page: Check pictures, for pictures that have no
// picture-check result yet (made before Sprint 8, or whose check didn't run).
// The AI flags, and a person decides each item on the ad's Compliance view.
import { TextLink } from "@/components/ui/button";
import type { CreativeView } from "@/lib/creative/gallery";
import { PictureCheckButton } from "./picture-check-button";

export function PictureCheckBar({ view }: { view: CreativeView }) {
  const p = view.pictureCheck;
  const running = !!p.runningRunId;
  return (
    <div className="flex flex-col gap-3 rounded-field bg-surface px-4 py-3 sm:flex-row sm:items-start sm:justify-between" data-picture-check-bar="">
      <div className="min-w-0 max-w-prose space-y-1.5">
        <p className="font-semibold">Picture checks</p>
        <p className="text-sm text-ink-2">
          Each picture is checked by AI when it is drawn: for text, for a face in close-up (finance brands) and for anything that
          may break the brand&apos;s don&apos;t rules. The AI only flags: what it finds is a Review item on each ad that uses the
          picture, for a person to decide.{" "}
          {p.todo > 0 && (
            <span data-picture-check-todo="">
              {p.todo === 1 ? "1 picture has" : `${p.todo} pictures have`} no result yet, so {p.todo === 1 ? "its" : "their"} ads show Review until
              {p.todo === 1 ? " it is" : " they are"} checked.
            </span>
          )}
        </p>
        {running && (
          <p role="status" className="text-sm text-primary">
            Checking pictures. <TextLink href={`/runs/${p.runningRunId}`}>See the run</TextLink>
          </p>
        )}
      </div>
      <PictureCheckButton campaignId={view.campaignId} estimate={p.estimate} reason={p.reason} running={running} />
    </div>
  );
}
