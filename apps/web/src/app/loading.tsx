// DEF-05: Missing loading.tsx — blank white screen on slow connections/cold starts.
export default function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading page…" className="animate-pulse">
      {/* Header skeleton */}
      <div className="h-16 border-b border-[rgba(0,0,0,0.08)] flex items-center px-6 gap-6">
        <div className="h-5 w-28 rounded-[2px] bg-[rgba(0,0,0,0.07)]" />
        <div className="hidden md:flex gap-5 ml-8">
          {[80,60,72,64].map((w,i) => <div key={i} className="h-3.5 rounded-[2px] bg-[rgba(0,0,0,0.06)]" style={{ width:w }} />)}
        </div>
        <div className="ml-auto h-8 w-20 rounded-[2px] bg-[rgba(0,0,0,0.07)]" />
      </div>
      {/* Hero skeleton */}
      <div className="flex flex-col items-center gap-6 px-6 pt-20 pb-16 max-w-3xl mx-auto">
        <div className="h-3 w-36 rounded-[2px] bg-[rgba(0,0,0,0.06)]" />
        <div className="h-12 w-full max-w-xl rounded-[2px] bg-[rgba(0,0,0,0.08)]" />
        <div className="h-12 w-3/4 rounded-[2px] bg-[rgba(0,0,0,0.08)]" />
        <div className="h-4 w-80 rounded-[2px] bg-[rgba(0,0,0,0.05)]" />
        <div className="flex gap-3 mt-2">
          <div className="h-10 w-32 rounded-[2px] bg-[rgba(0,0,0,0.1)]" />
          <div className="h-10 w-28 rounded-[2px] bg-[rgba(0,0,0,0.06)]" />
        </div>
      </div>
      {/* Card row skeletons */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 px-6 max-w-5xl mx-auto pb-16">
        {[1,2,3].map(i => (
          <div key={i} className="rounded-[2px] border border-[rgba(0,0,0,0.07)] p-6 flex flex-col gap-3">
            <div className="h-5 w-20 rounded-[2px] bg-[rgba(0,0,0,0.08)]" />
            <div className="h-3 w-full rounded-[2px] bg-[rgba(0,0,0,0.05)]" />
            <div className="h-3 w-4/5 rounded-[2px] bg-[rgba(0,0,0,0.05)]" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
