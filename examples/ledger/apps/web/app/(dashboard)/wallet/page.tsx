'use client';

import { useState } from 'react';
import {
  useEntity,
  createEntity,
  adjustEntity,
} from 'monorise/react';
import { Entity } from '#/monorise/config';
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { Label } from '#/components/ui/label';
import { Badge } from '#/components/ui/badge';

const WALLET_ID = 'demo-wallet';

function formatCurrency(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function WalletPage() {
  const { entity: wallet, isLoading } = useEntity(Entity.WALLET, WALLET_ID);
  const [amount, setAmount] = useState('');
  const [log, setLog] = useState<
    { action: string; amount: number; result: string; time: string }[]
  >([]);
  const [processing, setProcessing] = useState(false);

  const addLog = (action: string, amount: number, result: string) => {
    setLog((prev) => [
      { action, amount, result, time: new Date().toLocaleTimeString() },
      ...prev.slice(0, 19),
    ]);
  };

  const handleCreate = async () => {
    setProcessing(true);
    const { data, error } = await createEntity(
      Entity.WALLET,
      { name: 'Demo Wallet', balance: 10000 } as any,
      { entityId: WALLET_ID, isInterruptive: false },
    );
    if (error) {
      addLog('create', 10000, 'Failed — wallet may already exist');
    } else {
      addLog('create', 10000, `Created with ${formatCurrency(10000)}`);
    }
    setProcessing(false);
  };

  const handleAdjust = async (delta: number) => {
    setProcessing(true);
    const { data, error } = await adjustEntity(
      Entity.WALLET,
      WALLET_ID,
      { balance: delta },
      { isInterruptive: false },
    );
    if (error) {
      addLog(
        delta > 0 ? 'deposit' : 'withdraw',
        Math.abs(delta),
        'Failed — insufficient balance',
      );
    } else {
      addLog(
        delta > 0 ? 'deposit' : 'withdraw',
        Math.abs(delta),
        `Success — new balance: ${formatCurrency(data?.data?.balance ?? 0)}`,
      );
    }
    setProcessing(false);
  };

  const parsedAmount = Math.round(parseFloat(amount || '0') * 100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Wallet</h1>
        <p className="text-sm text-muted-foreground">
          Demonstrates <code>adjustEntity</code> with{' '}
          <code>adjustmentConstraints</code> — balance cannot go below $0.00
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Balance</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : wallet ? (
            <div className="space-y-4">
              <div className="text-4xl font-bold">
                {formatCurrency(wallet.data.balance ?? 0)}
              </div>
              <div className="flex items-end gap-3">
                <div className="space-y-1.5">
                  <Label>Amount ($)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="10.00"
                    className="w-40"
                  />
                </div>
                <Button
                  onClick={() => handleAdjust(parsedAmount)}
                  disabled={processing || parsedAmount <= 0}
                  variant="default"
                >
                  Deposit
                </Button>
                <Button
                  onClick={() => handleAdjust(-parsedAmount)}
                  disabled={processing || parsedAmount <= 0}
                  variant="destructive"
                >
                  Withdraw
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-muted-foreground">
                No wallet found. Create a demo wallet to get started.
              </p>
              <Button onClick={handleCreate} disabled={processing}>
                Create Demo Wallet ($100.00)
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {log.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Activity Log</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {log.map((entry, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        entry.action === 'deposit'
                          ? 'default'
                          : entry.action === 'withdraw'
                            ? 'destructive'
                            : 'secondary'
                      }
                    >
                      {entry.action}
                    </Badge>
                    <span className="font-medium">
                      {formatCurrency(entry.amount)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={
                        entry.result.startsWith('Failed')
                          ? 'text-red-600'
                          : 'text-green-600'
                      }
                    >
                      {entry.result}
                    </span>
                    <span className="text-muted-foreground">{entry.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Testing Concurrent Adjustments
          </CardTitle>
        </CardHeader>
        <CardContent className="prose prose-sm max-w-none text-muted-foreground">
          <p>
            This wallet uses <code>adjustmentConstraints: {'{ balance: { min: 0 } }'}</code> —
            the balance can never go below $0.00, enforced at the database level.
          </p>
          <p className="font-medium text-foreground">To test concurrent safety:</p>
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Open this page in <strong>two browser tabs</strong> (or use an incognito window)
            </li>
            <li>
              In both tabs, set the withdrawal amount to an amount close to the current balance
              (e.g., if balance is $100, set both to $70)
            </li>
            <li>
              Click <strong>Withdraw</strong> in both tabs as simultaneously as possible
            </li>
            <li>
              <strong>Expected result:</strong> One withdrawal succeeds, the other fails with
              &quot;insufficient balance&quot; — the balance never goes negative
            </li>
          </ol>
          <p>
            Without <code>adjustmentConstraints</code>, both withdrawals would succeed and the
            balance would go to -$40.00. The constraint prevents this at the database level —
            no matter how fast the requests arrive.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
