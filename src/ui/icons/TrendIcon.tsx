import type { SVGProps } from "react";

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

export function TrendIcon({ size = 24, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <path
        d="M3.5 3.8c-.3 5.4-.2 10.6.3 16 5.5.4 10.9.5 16.4.2"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.4 15.9c1.9-2.4 3.4-5 5.3-3.4 1.5 1.3 2.1 1.6 3.3.2 1.4-1.7 2.5-4 4.4-6.4"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="6.4" cy="15.9" r="1.5" fill="currentColor" />
      <circle cx="12.6" cy="13.1" r="1.5" fill="currentColor" />
      <circle cx="19.4" cy="6.3" r="1.5" fill="currentColor" />
    </svg>
  );
}
