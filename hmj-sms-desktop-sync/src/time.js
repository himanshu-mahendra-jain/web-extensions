// How long ago a timestamp was: "Just now", "5m ago", "2h ago" or "3d ago".
export function formatTimeAgo(timestamp) {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "Just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
