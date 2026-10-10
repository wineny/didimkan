"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** 바닥에서 올라오는 시트. ESC·배경 클릭으로 닫히고, 열리면 시트로 포커스가 옮겨 가며 Tab 이 시트 안에서만 돈다. */
export default function BottomSheet({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => opener?.focus();
  }, [open]);

  if (!open) return null;

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      onClose();
      return;
    }
    if (e.key !== "Tab" || !ref.current) return;
    const items = ref.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="c-scrim" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-sheet
        tabIndex={-1}
        className="c-sheet"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  );
}
