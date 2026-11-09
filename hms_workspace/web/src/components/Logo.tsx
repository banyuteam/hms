import logoMark from '@/assets/brand/logo-mark.png';

/** Figma component "Logo / Type=Mark". PNG until vectors are supplied (open question). Never recolour or stretch. */
export function Logo({ size = 40 }: { size?: number }) {
  return <img src={logoMark} width={size} height={size} alt="" className="block" />;
}
