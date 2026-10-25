import { NotFoundCard } from "@/components/not-found-card";

// notFound() inside the signed-in app (for example another workspace's run):
// the same message, within the shell.
export default function AppNotFound() {
  return <NotFoundCard />;
}
