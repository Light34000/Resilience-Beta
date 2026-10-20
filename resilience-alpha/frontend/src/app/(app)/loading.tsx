import { Skeleton, TableSkeleton } from "@/components/ui/states";

export default function Loading() {
  return (
    <div aria-busy="true">
      <div className="mb-6 flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="rounded-lg border border-border bg-surface">
        <TableSkeleton rows={6} label="Chargement de la page" />
      </div>
    </div>
  );
}
