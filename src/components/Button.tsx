import Link from "next/link";
import type { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
  href?: string;
};

/** primary = 파란 큰 버튼(.cta), secondary = 테두리 버튼(.sbtn). href 가 있으면 링크. */
export default function Button({ variant = "primary", href, className, children, ...rest }: Props) {
  const cls = `${variant === "primary" ? "cta" : "sbtn"} ${className ?? ""}`.trim();
  if (href) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} {...rest}>
      {children}
    </button>
  );
}
