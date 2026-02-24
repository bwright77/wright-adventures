interface LogoProps {
  className?: string
}

export function Logo({ className = '' }: LogoProps) {
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M20 4L35 34H5L20 4Z" fill="#004667" opacity="0.9" />
      <path d="M20 12L28 30H12L20 12Z" fill="#FFFFFF" opacity="0.3" />
      <path
        d="M10 28C14 24 18 26 22 23C26 20 30 22 34 28"
        stroke="#009DD6"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  )
}
