import "./globals.css";
import React from "react";
import type { Metadata } from "next";

/**
 * Root layout for the product app (the canvas at `/`). This is one of two root
 * layouts in the app — the docs site under `/docs` has its own
 * (`(docs)/layout.tsx`) so Nextra's theme CSS and the product's Tailwind stay
 * fully isolated. See `next.config.mjs`.
 */
export const metadata: Metadata = {
  title: "Strata",
  description: "Strata — design, validate, and understand AWS cloud architecture visually.",
};

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="h-screen">{children}</body>
    </html>
  );
}
