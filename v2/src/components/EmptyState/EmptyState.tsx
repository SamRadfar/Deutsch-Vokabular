import './EmptyState.css';

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="empty-state" role="status" lang="fa" dir="rtl">
      <p className="empty-state__title">{title}</p>
      {description ? <p className="empty-state__desc">{description}</p> : null}
    </div>
  );
}
