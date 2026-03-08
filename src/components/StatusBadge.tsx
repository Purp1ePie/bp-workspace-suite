import { useI18n } from '@/lib/i18n';

const statusColors: Record<string, string> = {
  new: 'bg-info/15 text-info',
  in_progress: 'bg-warning/15 text-warning',
  submitted: 'bg-primary/15 text-primary',
  won: 'bg-success/15 text-success',
  lost: 'bg-destructive/15 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
};

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const key = `status.${status}` as any;
  const label = t(key) || status;
  const color = statusColors[status] || 'bg-muted text-muted-foreground';

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${color}`}>
      {label}
    </span>
  );
}
