export const EXAMPLE_PAGE_TEMPLATE = `'use client';

import { useState } from 'react';
import { useEntities, createEntity } from 'monorise/react';
import { Entity } from '#/monorise/config';

export default function Home() {
  const { entities: users, isLoading } = useEntities(Entity.USER);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName || !email) return;

    setIsCreating(true);
    try {
      await createEntity(Entity.USER, {
        displayName,
        email,
      });
      // The list automatically updates via the store!
      // Clear form
      setDisplayName('');
      setEmail('');
    } catch (error) {
      console.error('Failed to create user:', error);
      alert('Failed to create user. Check console for details.');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <main className="min-h-screen p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Monorise Demo</h1>

      {/* Create User Form */}
      <section className="mb-8 p-6 border rounded-lg bg-gray-50">
        <h2 className="text-xl font-semibold mb-4">Create User</h2>
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 border rounded"
              placeholder="John Doe"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border rounded"
              placeholder="john@example.com"
              required
            />
          </div>
          <button
            type="submit"
            disabled={isCreating}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {isCreating ? 'Creating...' : 'Create User'}
          </button>
        </form>
      </section>

      {/* Users List */}
      <section className="p-6 border rounded-lg">
        <h2 className="text-xl font-semibold mb-4">Users</h2>
        {isLoading ? (
          <p>Loading...</p>
        ) : users && users.length > 0 ? (
          <ul className="space-y-2">
            {users.map((user) => (
              <li key={user.entityId} className="p-3 bg-white border rounded">
                <p className="font-medium">{user.data.displayName}</p>
                <p className="text-sm text-gray-600">{user.data.email}</p>
                <p className="text-xs text-gray-400 mt-1">ID: {user.entityId}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-500">No users yet. Create one above!</p>
        )}
      </section>
    </main>
  );
}
`;
