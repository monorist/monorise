import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'WebSocket Chat',
  description: 'Monorise WebSocket Chat Example',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
