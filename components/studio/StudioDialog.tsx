'use client';

import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface StudioDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  titleId: string;
  maxWidthClass?: string;
  dismissable?: boolean;
  headerExtra?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export function StudioDialog({
  isOpen,
  onClose,
  title,
  subtitle,
  titleId,
  maxWidthClass = 'max-w-xl',
  dismissable = true,
  headerExtra,
  footer,
  children,
}: StudioDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  // Progressive-enhancement click-outside fallback when closedby="any" is unsupported
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !isOpen || !dismissable) return;
    if ('closedBy' in HTMLDialogElement.prototype) return;

    const isOutside = (e: PointerEvent): boolean => {
      const rect = dialog.getBoundingClientRect();
      return (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      );
    };

    let pressedOutside = false;
    const handlePointerDown = (e: PointerEvent) => {
      pressedOutside = isOutside(e);
    };
    const handlePointerUp = (e: PointerEvent) => {
      if (pressedOutside && isOutside(e) && dialog.open) {
        dialog.close();
      }
      pressedOutside = false;
    };

    dialog.addEventListener('pointerdown', handlePointerDown);
    dialog.addEventListener('pointerup', handlePointerUp);
    return () => {
      dialog.removeEventListener('pointerdown', handlePointerDown);
      dialog.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isOpen, dismissable]);

  if (!isOpen) return null;

  const closedByProps = {
    closedby: dismissable ? 'any' : 'closerequest',
  } as Record<string, string>;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={() => {
        const dialog = dialogRef.current;
        if (dialog) {
          dialog.returnValue = '';
        }
        onClose();
      }}
      {...closedByProps}
      className={`w-[calc(100vw-2rem)] ${maxWidthClass} max-h-[88dvh] rounded-2xl border border-white/[0.11] bg-[#10131C] text-[#F3F4F6] shadow-[0_24px_64px_rgba(0,0,0,0.78)] overflow-hidden`}
    >
      <div className="flex items-start justify-between gap-4 border-b border-white/[0.08] px-6 py-4 shrink-0">
        <div className="min-w-0 space-y-1">
          <h1
            id={titleId}
            className="font-display text-base font-semibold text-[#F3F4F6] flex items-center gap-2"
          >
            {title}
          </h1>
          {subtitle && (
            <p className="text-xs text-[#A6B0C3] leading-relaxed">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {headerExtra}
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть окно"
            className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-lg border border-transparent text-[#8893A8] transition-colors hover:bg-white/[0.06] hover:text-[#F3F4F6]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto studio-scroll px-6 py-5">
        {children}
      </div>

      {footer && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] bg-[#0A0C12] px-6 py-3.5 shrink-0">
          {footer}
        </div>
      )}
    </dialog>
  );
}
