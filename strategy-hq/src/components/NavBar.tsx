'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/', label: 'Home', icon: '⌂' },
  { href: '/scouts', label: 'Scouts', icon: '◉' },
  { href: '/map', label: 'Map', icon: '◎' },
  { href: '/intel', label: 'Intel', icon: '✦' },
  { href: '/playbook', label: 'Playbook', icon: '▣' },
  { href: '/assist', label: 'Coach', icon: '◆' },
  { href: '/brief', label: 'Brief', icon: '☼' },
];

export function NavBar() {
  const path = usePathname();
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  return (
    <nav className="nav" aria-label="Main">
      {ITEMS.map((i) => (
        <Link key={i.href} href={i.href} aria-current={active(i.href) ? 'page' : undefined}>
          <span className="i" aria-hidden="true">{i.icon}</span>
          <span className="l">{i.label}</span>
        </Link>
      ))}
    </nav>
  );
}
