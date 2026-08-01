import type { CSSProperties } from 'react';

export function KimiIcon({
  size = 20,
  style,
  className,
}: {
  size?: number;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      aria-hidden
    >
      <rect x="2" y="2" width="20" height="20" rx="6" fill="currentColor" opacity="0.12" />
      <path
        d="M7 16.5V7.5h2.1l2.35 5.2L13.8 7.5H16v9h-1.7v-5.55L12.2 16.5h-1.35L8.7 10.95V16.5H7z"
        fill="currentColor"
      />
    </svg>
  );
}
