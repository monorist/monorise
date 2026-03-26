import { nanoid } from 'nanoid';

export interface OptimisticOperation {
  id: string;
  type: 'create' | 'update' | 'delete';
  entityType: string;
  entityId: string;
  previousData?: unknown;
  optimisticData: unknown;
  timestamp: number;
}

export class OptimisticEngine {
  private operations: Map<string, OptimisticOperation> = new Map();
  private onRollback?: (operation: OptimisticOperation) => void;
  private onConfirm?: (operation: OptimisticOperation) => void;

  constructor(options?: {
    onRollback?: (operation: OptimisticOperation) => void;
    onConfirm?: (operation: OptimisticOperation) => void;
  }) {
    this.onRollback = options?.onRollback;
    this.onConfirm = options?.onConfirm;
  }

  /**
   * Register an optimistic operation
   */
  register(operation: Omit<OptimisticOperation, 'id' | 'timestamp'>): string {
    const id = nanoid();
    const fullOperation: OptimisticOperation = {
      ...operation,
      id,
      timestamp: Date.now(),
    };

    this.operations.set(id, fullOperation);
    return id;
  }

  /**
   * Confirm an operation (server acknowledged)
   */
  confirm(mutationId: string): void {
    const operation = this.operations.get(mutationId);
    if (operation) {
      this.operations.delete(mutationId);
      this.onConfirm?.(operation);
    }
  }

  /**
   * Rollback an operation (server rejected or failed)
   */
  rollback(mutationId: string): OptimisticOperation | undefined {
    const operation = this.operations.get(mutationId);
    if (operation) {
      this.operations.delete(mutationId);
      this.onRollback?.(operation);
      return operation;
    }
    return undefined;
  }

  /**
   * Check if an entity has pending optimistic operations
   */
  hasPendingOperation(entityType: string, entityId: string): boolean {
    for (const op of this.operations.values()) {
      if (op.entityType === entityType && op.entityId === entityId) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get pending operation for an entity
   */
  getPendingOperation(
    entityType: string,
    entityId: string,
  ): OptimisticOperation | undefined {
    for (const op of this.operations.values()) {
      if (op.entityType === entityType && op.entityId === entityId) {
        return op;
      }
    }
    return undefined;
  }

  /**
   * Clear all operations (e.g., on disconnect)
   */
  clear(): OptimisticOperation[] {
    const allOperations = Array.from(this.operations.values());
    this.operations.clear();
    return allOperations;
  }

  /**
   * Get all pending operations
   */
  getAllPending(): OptimisticOperation[] {
    return Array.from(this.operations.values());
  }

  /**
   * Clean up old operations (older than specified ms)
   */
  cleanup(maxAgeMs: number = 5 * 60 * 1000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, operation] of this.operations) {
      if (now - operation.timestamp > maxAgeMs) {
        this.operations.delete(id);
        cleaned++;
      }
    }

    return cleaned;
  }
}
