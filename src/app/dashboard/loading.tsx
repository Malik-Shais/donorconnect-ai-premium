export default function Loading() {
  return <div aria-busy="true" aria-label="Loading" className="grid gap-4 p-6">{[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-line/60" />)}</div>;
}
