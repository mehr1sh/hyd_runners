"use client";

/** Last-resort boundary when the root layout itself fails. Keep it dependency-free. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en-IN">
      <body
        style={{ fontFamily: "system-ui, sans-serif", color: "#2c335a", padding: "4rem 1rem", textAlign: "center" }}
      >
        <h1>HYD Runners is having trouble</h1>
        <p>Please try again in a moment.</p>
        <button
          onClick={reset}
          style={{ background: "#e31e25", color: "#fff", border: 0, borderRadius: 8, padding: "0.6rem 1.2rem" }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
