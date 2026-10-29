import logoMark from '@assets/brand/logo-mark.png';

/** Figma component "Logo / Type=Mark". PNG (from docs/mockups/logo-3.png) until vectors are supplied (OQ-32). */
export function Logo({ size = 40 }: { size?: number }) {
  return <img src={logoMark} width={size} height={size} alt="" style={{ display: 'block' }} />;
}
