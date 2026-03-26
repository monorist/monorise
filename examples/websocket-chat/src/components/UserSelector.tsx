import { DEMO_USERS } from '../lib/monorise'

interface UserSelectorProps {
  onSelect: (userId: string) => void
  currentUserId?: string | null
}

export function UserSelector({ onSelect, currentUserId }: UserSelectorProps) {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const userId = e.target.value
    if (userId) {
      onSelect(userId)
    }
  }

  const currentUser = DEMO_USERS.find(u => u.userId === currentUserId)

  return (
    <select 
      className="user-selector" 
      onChange={handleChange}
      value={currentUserId || ''}
    >
      {!currentUserId && <option value="">Select a user...</option>}
      {DEMO_USERS.map(user => (
        <option key={user.userId} value={user.userId}>
          {user.name}
        </option>
      ))}
    </select>
  )
}
