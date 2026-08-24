import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'

type Variant = 'primary' | 'sound' | 'outline' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

const base =
  'inline-flex items-center justify-center gap-2 rounded-full font-semibold ' +
  'transition-[transform,background-color,color,border-color] duration-150 ' +
  'active:translate-y-px disabled:pointer-events-none disabled:opacity-45 ' +
  'whitespace-nowrap'

const variants: Record<Variant, string> = {
  primary: 'bg-ink text-paper hover:bg-ink-soft',
  // Reads its colour from the nearest --sound container.
  sound: 'sound-bg text-white hover:brightness-95',
  outline: 'border-2 border-ink text-ink hover:bg-ink hover:text-paper',
  ghost: 'text-ink-soft hover:bg-paper-2 hover:text-ink',
}

// `min-h-11` is 44px, the smallest reliable touch target. Small buttons were
// 36px tall — fine with a mouse, fiddly with a thumb. The minimum is lifted
// at `sm:` so the desktop layout keeps its proportions; md and lg already
// clear 44px from their padding alone.
const sizes: Record<Size, string> = {
  sm: 'min-h-11 px-4 py-2 text-sm sm:min-h-0',
  md: 'px-6 py-3 text-base',
  lg: 'px-8 py-4 text-lg',
}

export function buttonClass(variant: Variant = 'primary', size: Size = 'md') {
  return `${base} ${variants[variant]} ${sizes[size]}`
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  children: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button className={`${buttonClass(variant, size)} ${className}`} {...rest}>
      {children}
    </button>
  )
}

interface ButtonLinkProps {
  to: string
  variant?: Variant
  size?: Size
  className?: string
  children: ReactNode
  onClick?: () => void
}

export function ButtonLink({
  to,
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  onClick,
}: ButtonLinkProps) {
  return (
    <Link to={to} onClick={onClick} className={`${buttonClass(variant, size)} ${className}`}>
      {children}
    </Link>
  )
}
