import logoLight from "../assets/logo.png";
import logoDark from "../assets/logo-dark.png";

/**
 * The Scaltrix logo. Two transparent versions are included: the normal colours
 * for the light theme, and a brightened one (light tagline) for the dark theme.
 * Tailwind's `dark:` switch shows the right one.
 */
export default function Logo({ className = "h-10 w-auto" }: { className?: string }) {
  return (
    <>
      <img src={logoLight} alt="Scaltrix: Elevate, Expand, Excel" className={`${className} dark:hidden`} draggable={false} />
      <img src={logoDark} alt="" aria-hidden="true" className={`${className} hidden dark:block`} draggable={false} />
    </>
  );
}
