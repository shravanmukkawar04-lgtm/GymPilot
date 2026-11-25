/**
 * The Kineto mark: a K drawn as an athlete mid-leap. The dot is the head,
 * the upper stroke a raised arm, the lower stroke a striding leg.
 * app/icon.svg is the same drawing, used as the browser tab icon.
 */
export const BRAND = 'Kineto';

export function LogoMark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--color-brand)" />
      <path d="M9.5 8v16m0-6.5 7.3-6.4m-4.2 3.7 7.9 9.2" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="21.4" cy="7.6" r="2.4" fill="#fff" />
    </svg>
  );
}
