export function BidPilotLogo({ className = '' }: { className?: string }) {
  return (
    <span className={`font-heading font-bold tracking-tight ${className}`}>
      <span className="text-foreground">Bid</span>
      <span className="text-primary">Pilot</span>
    </span>
  );
}
