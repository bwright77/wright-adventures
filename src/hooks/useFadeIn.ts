import { useInView } from 'react-intersection-observer'

interface UseFadeInOptions {
  threshold?: number
  triggerOnce?: boolean
  rootMargin?: string
  delay?: number
}

export function useFadeIn(options: UseFadeInOptions = {}) {
  const {
    threshold = 0.1,
    triggerOnce = true,
    rootMargin = '0px 0px -40px 0px',
  } = options

  const { ref, inView } = useInView({
    threshold,
    triggerOnce,
    rootMargin,
  })

  const style: React.CSSProperties = {
    opacity: inView ? 1 : 0,
    transform: inView ? 'translateY(0)' : 'translateY(24px)',
    transition: `opacity 0.6s ease-out${options.delay ? ` ${options.delay}ms` : ''}, transform 0.6s ease-out${options.delay ? ` ${options.delay}ms` : ''}`,
    transitionDelay: options.delay ? `${options.delay}ms` : '0ms',
  }

  return { ref, style, inView }
}
