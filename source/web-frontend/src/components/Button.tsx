import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components';
import styles from './Button.module.css';

export interface ButtonProps extends AriaButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost';
  block?: boolean;
}

/** Figma component "Button": Style = Primary | Secondary | Ghost, State = Default | Disabled. */
export function Button({ variant = 'secondary', block, className, ...props }: ButtonProps) {
  return (
    <AriaButton
      {...props}
      className={[styles.button, styles[variant], block ? styles.block : '', className]
        .filter((c) => typeof c === 'string' && c)
        .join(' ')}
    />
  );
}
