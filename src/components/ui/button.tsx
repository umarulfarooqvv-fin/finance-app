'use client';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

const button = cva(
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-field)] text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]',
  {
    variants: {
      variant: {
        primary: 'bg-[var(--color-accent)] text-[var(--color-accent-ink)] hover:opacity-90',
        secondary:
          'border border-[var(--color-line)] text-[var(--color-ink-2)] hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink)]',
        ghost: 'text-[var(--color-ink-2)] hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)]',
        // Reserved for actions that remove financial history.
        danger: 'bg-[var(--color-neg)] text-white hover:opacity-90',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-4',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof button> & {
    asChild?: boolean;
    /** Shows a spinner and blocks repeat clicks — the first line against
        double submission. The server's idempotency key is the second. */
    pending?: boolean;
  };

export function Button({
  className, variant, size, asChild, pending, children, disabled, ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      className={cn(button({ variant, size }), className)}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      {...props}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </Comp>
  );
}
