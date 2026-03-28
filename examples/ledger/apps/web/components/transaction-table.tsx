'use client';

import { useEntity } from 'monorise/react';
import { Entity } from '#/monorise/entities';
import { Badge } from '#/components/ui/badge';

type Transaction = {
  entityId: string;
  data: {
    amount: number;
    type: 'sale' | 'refund' | 'discount';
    description?: string;
    transactionDate: string;
    status: string;
    merchantId: string;
    buyerId: string;
  };
};

function formatCurrency(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

const typeBadgeVariant: Record<string, 'default' | 'destructive' | 'secondary' | 'outline'> = {
  sale: 'default',
  refund: 'destructive',
  discount: 'secondary',
};

export default function TransactionTable({
  transactions,
  isLoading,
  showMerchant = true,
  showBuyer = true,
}: {
  transactions: Transaction[];
  isLoading: boolean;
  showMerchant?: boolean;
  showBuyer?: boolean;
}) {
  if (isLoading) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Loading transactions...</p>;
  }

  if (!transactions.length) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No transactions found.</p>;
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-left text-sm">
        <thead className="border-b bg-muted/50 text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Date</th>
            <th className="px-4 py-3 font-medium">Type</th>
            <th className="px-4 py-3 font-medium">Amount</th>
            {showMerchant && <th className="px-4 py-3 font-medium">Merchant</th>}
            {showBuyer && <th className="px-4 py-3 font-medium">Buyer</th>}
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Description</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {transactions.map((txn) => (
            <TransactionRow
              key={txn.entityId}
              txn={txn}
              showMerchant={showMerchant}
              showBuyer={showBuyer}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TransactionRow({
  txn,
  showMerchant,
  showBuyer,
}: {
  txn: Transaction;
  showMerchant: boolean;
  showBuyer: boolean;
}) {
  return (
    <tr className="hover:bg-muted/30">
      <td className="whitespace-nowrap px-4 py-3">
        {txn.data.transactionDate?.split('T')[0]}
      </td>
      <td className="px-4 py-3">
        <Badge variant={typeBadgeVariant[txn.data.type] || 'outline'}>
          {txn.data.type}
        </Badge>
      </td>
      <td className="px-4 py-3 font-medium">
        {formatCurrency(txn.data.amount)}
      </td>
      {showMerchant && (
        <td className="px-4 py-3">
          <EntityName entityType={Entity.MERCHANT} entityId={txn.data.merchantId} />
        </td>
      )}
      {showBuyer && (
        <td className="px-4 py-3">
          <EntityName entityType={Entity.BUYER} entityId={txn.data.buyerId} />
        </td>
      )}
      <td className="px-4 py-3 capitalize">{txn.data.status}</td>
      <td className="px-4 py-3 text-muted-foreground">
        {txn.data.description || '—'}
      </td>
    </tr>
  );
}

function EntityName({ entityType, entityId }: { entityType: any; entityId: string }) {
  const { entity } = useEntity(entityType, entityId);
  return <>{entity?.data?.name ?? entityId.slice(0, 8) + '...'}</>;
}
