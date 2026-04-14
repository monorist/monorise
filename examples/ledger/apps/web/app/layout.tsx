import type { Metadata } from 'next';
import GlobalInitializer from '#/components/global-initializer';
import GlobalLoader from '#/components/global-loader';
import './globals.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ledger Dashboard',
  description: 'Monorise Ledger Example — Transaction management with DynamoDB',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased">
        <div id="loader-portal" />
        <GlobalInitializer />
        <GlobalLoader />
        {children}
      </body>
    </html>
  );
}
