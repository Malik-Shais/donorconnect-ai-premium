"use client";
import { useEffect } from "react";
import { MotionConfig } from "motion/react";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Service worker only in production builds so dev HMR is never cached.
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
