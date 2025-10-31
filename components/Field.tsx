"use client";
import { ReactNode } from "react";
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label>{label}</label>
      {children}
    </div>
  );
}
