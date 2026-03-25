import type { Metadata } from 'next';
import './globals.css';

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
      <body className="bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  );
}
