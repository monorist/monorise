'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '#/lib/utils';

const navItems = [
  { label: 'Merchants', href: '/merchants' },
  { label: 'Buyers', href: '/buyers' },
  { label: 'Transactions', href: '/transactions' },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen">
      <header className="border-b bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-8 px-6">
          <Link href="/transactions" className="text-lg font-bold">
            Ledger
          </Link>
          <nav className="flex gap-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  pathname === item.href
                    ? 'bg-gray-100 text-gray-900'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
