import lightLogo from '../assets/images/wa_logo_horizontal_light.png'
import darkLogo from '../assets/images/wa_logo_horizontal_dark.png'

interface LogoProps {
  dark?: boolean
  className?: string
}

export function Logo({ dark = false, className = '' }: LogoProps) {
  return (
    <img
      src={dark ? darkLogo : lightLogo}
      alt="Wright Adventures"
      className={className}
    />
  )
}
