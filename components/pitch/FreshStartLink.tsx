"use client";

import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";

interface FreshStartLinkProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children" | "href"> {
  href: string;
  children: ReactNode;
}

const SESSION_STORAGE_KEYS = ["shark_session_id"];

export function FreshStartLink({
  href,
  onClick,
  children,
  ...props
}: FreshStartLinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented) return;

    event.preventDefault();
    for (const key of SESSION_STORAGE_KEYS) {
      sessionStorage.removeItem(key);
    }
    window.location.assign(href);
  }

  return (
    <a href={href} onClick={handleClick} {...props}>
      {children}
    </a>
  );
}
