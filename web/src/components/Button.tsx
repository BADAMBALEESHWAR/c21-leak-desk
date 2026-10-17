import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'ai';
type Size = 'sm' | 'md' | 'lg';

interface Shared {
  variant?: ButtonVariant;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
}

function classes(variant: ButtonVariant, size: Size, className?: string) {
  return ['btn', `btn-${variant}`, `btn-${size}`, className].filter(Boolean).join(' ');
}

function Content({ icon, iconRight, children, size }: { icon?: IconName; iconRight?: IconName; children: ReactNode; size: Size }) {
  const px = size === 'sm' ? 15 : 17;
  return (
    <>
      {icon ? <Icon name={icon} size={px} /> : null}
      <span>{children}</span>
      {iconRight ? <Icon name={iconRight} size={px} /> : null}
    </>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & Shared;

/** primary = black pill (one per screen), secondary = outline pill, ghost = text, ai = gradient pill. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'ghost', size = 'md', icon, iconRight, className, type = 'button', children, ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={classes(variant, size, className)} {...rest}>
      <Content icon={icon} iconRight={iconRight} size={size}>
        {children}
      </Content>
    </button>
  );
});

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & Shared;

/** An anchor that looks like a button (navigation, downloads). */
export function ButtonLink({ variant = 'secondary', size = 'md', icon, iconRight, className, children, ...rest }: LinkProps) {
  return (
    <a className={classes(variant, size, className)} {...rest}>
      <Content icon={icon} iconRight={iconRight} size={size}>
        {children}
      </Content>
    </a>
  );
}

/** A button that reads as an inline link (order ids, example ids). */
export function LinkButton({ className, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={['link-button', className].filter(Boolean).join(' ')} {...rest} />;
}

/** Square icon-only button with an accessible name. */
export function IconButton({ icon, label, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return (
    <button type="button" className={['icon-btn', className].filter(Boolean).join(' ')} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={18} />
    </button>
  );
}
