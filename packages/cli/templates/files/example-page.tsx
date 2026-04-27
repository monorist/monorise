'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { useEntities, createEntity } from 'monorise/react';
import { Entity, FormSchema } from '#/monorise/config';
import { Button } from '#/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card';
import { Input } from '#/components/ui/input';
import { Label } from '#/components/ui/label';

const formSchema = FormSchema[Entity.USER];
type FormValues = z.infer<typeof formSchema>;

export default function Home() {
  const { entities: users, isLoading } = useEntities(Entity.USER);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      displayName: '',
      email: '',
    },
  });

  const onSubmit = async (values: FormValues) => {
    await createEntity(Entity.USER, values);
    form.reset();
  };

  return (
    <main className="min-h-screen p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Monorise Demo</h1>

      {/* Create User Form */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Create User</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                placeholder="John Doe"
                {...form.register('displayName')}
              />
              {form.formState.errors.displayName && (
                <p className="text-sm text-red-500">
                  {form.formState.errors.displayName.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="john@example.com"
                {...form.register('email')}
              />
              {form.formState.errors.email && (
                <p className="text-sm text-red-500">
                  {form.formState.errors.email.message}
                </p>
              )}
            </div>
            <Button type="submit">Create User</Button>
          </form>
        </CardContent>
      </Card>

      {/* Users List */}
      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p>Loading...</p>
          ) : users && users.length > 0 ? (
            <ul className="space-y-2">
              {users.map((user) => (
                <li key={user.entityId} className="p-3 bg-muted rounded-lg">
                  <p className="font-medium">{user.data.displayName}</p>
                  <p className="text-sm text-muted-foreground">
                    {user.data.email}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">
              No users yet. Create one above!
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
