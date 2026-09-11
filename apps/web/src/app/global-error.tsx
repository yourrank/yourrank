"use client";

// DEF-04: global-error.tsx handles root layout crashes — must supply own html/body.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily:"system-ui,sans-serif", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:"2rem", textAlign:"center", background:"#FCFCFC", color:"#191919", gap:"1rem" }}>
        <p style={{ fontSize:"0.7rem", letterSpacing:"0.15em", textTransform:"uppercase", opacity:0.5 }}>Critical Error</p>
        <h1 style={{ fontSize:"clamp(1.5rem,4vw,2.5rem)", fontWeight:600, margin:0 }}>YourRank encountered a critical error.</h1>
        <p style={{ maxWidth:"28rem", fontSize:"0.9rem", opacity:0.65, lineHeight:1.6 }}>
          Please try refreshing the page. If the problem persists, contact{" "}
          <a href="mailto:support@yourrank.site" style={{ color:"#2200FF" }}>support@yourrank.site</a>.
        </p>
        {error.digest && <p style={{ fontSize:"0.7rem", fontFamily:"monospace", opacity:0.4 }}>ID: {error.digest}</p>}
        <button onClick={reset} type="button" style={{ background:"#2200FF", color:"#fff", border:"none", borderRadius:"2px", padding:"0.6rem 1.4rem", fontSize:"0.875rem", cursor:"pointer", marginTop:"0.5rem" }}>
          Try again
        </button>
      </body>
    </html>
  );
}
