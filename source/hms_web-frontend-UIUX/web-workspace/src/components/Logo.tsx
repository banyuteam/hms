import logoMark from '@assets/brand/logo-mark.jpg';

/** Figma component "Logo / Type=Mark". Low-res JPG until vectors are supplied (OQ-32). */
export function Logo({ size = 40 }: { size?: number }) {
  return <img src={logoMark} width={size} height={size} alt="" style={{ display: 'block' }} />;
}
