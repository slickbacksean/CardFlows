import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '../lib/api'

export function Creators() {
  const queryClient = useQueryClient()
  const [sortBy, setSortBy] = useState<'signups' | 'activated' | 'scans' | 'purchases'>('signups')
  const [showCreateForm, setShowCreateForm] = useState(false)

  const { data: leaderboard } = useQuery({
    queryKey: ['creator-leaderboard', sortBy],
    queryFn: () => adminApi.getCreatorLeaderboard(sortBy, 20),
  })

  const createMutation = useMutation({
    mutationFn: adminApi.createCreator,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creator-leaderboard'] })
      setShowCreateForm(false)
    },
  })

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    createMutation.mutate({
      name: formData.get('name') as string,
      platform: formData.get('platform') as string,
      handle: formData.get('handle') as string,
      notes: formData.get('notes') as string || undefined,
    })
  }

  return (
    <div style={{ maxWidth: 1200 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 700 }}>Creator Leaderboard</h1>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          style={{
            background: 'var(--accent)',
            color: 'white',
            border: 'none',
            padding: '0.75rem 1.5rem',
            borderRadius: '0.5rem',
            fontWeight: 600,
          }}
        >
          {showCreateForm ? 'Cancel' : 'Add Creator'}
        </button>
      </div>

      {showCreateForm && (
        <form
          onSubmit={handleCreate}
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: '0.75rem',
            padding: '1.5rem',
            marginBottom: '1.5rem',
          }}
        >
          <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem' }}>New Creator</h3>
          <div style={{ display: 'grid', gap: '1rem', marginBottom: '1rem' }}>
            <input name="name" placeholder="Name" required />
            <select name="platform" required>
              <option value="">Select Platform</option>
              <option value="twitch">Twitch</option>
              <option value="youtube">YouTube</option>
              <option value="tiktok">TikTok</option>
              <option value="instagram">Instagram</option>
              <option value="twitter">Twitter</option>
              <option value="facebook">Facebook</option>
              <option value="other">Other</option>
            </select>
            <input name="handle" placeholder="Handle (e.g., @username)" required />
            <textarea name="notes" placeholder="Notes (optional)" rows={3} />
          </div>
          <button
            type="submit"
            disabled={createMutation.isPending}
            style={{
              background: 'var(--accent)',
              color: 'white',
              border: 'none',
              padding: '0.75rem 1.5rem',
              borderRadius: '0.5rem',
              fontWeight: 600,
            }}
          >
            {createMutation.isPending ? 'Creating...' : 'Create Creator'}
          </button>
        </form>
      )}

      <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
        {(['signups', 'activated', 'scans', 'purchases'] as const).map((sort) => (
          <button
            key={sort}
            onClick={() => setSortBy(sort)}
            style={{
              background: sortBy === sort ? 'var(--accent)' : 'var(--card)',
              color: sortBy === sort ? 'white' : 'var(--text)',
              border: '1px solid var(--border)',
              padding: '0.5rem 1rem',
              borderRadius: '0.5rem',
              fontWeight: 600,
              textTransform: 'capitalize',
            }}
          >
            {sort}
          </button>
        ))}
      </div>

      {leaderboard && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '0.75rem', overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Name</th>
                <th>Platform</th>
                <th>Code</th>
                <th>Signups</th>
                <th>Activated</th>
                <th>Scans</th>
                <th>Purchases</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.leaderboard.map((creator, index) => (
                <tr key={creator.creatorId}>
                  <td style={{ fontWeight: 700, color: index < 3 ? 'var(--accent)' : undefined }}>{index + 1}</td>
                  <td style={{ fontWeight: 600 }}>{creator.name}</td>
                  <td style={{ textTransform: 'capitalize' }}>{creator.platform}</td>
                  <td style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>{creator.inviteCode}</td>
                  <td>{creator.stats.signupsCount.toLocaleString()}</td>
                  <td>{creator.stats.activatedUsersCount.toLocaleString()}</td>
                  <td>{creator.stats.totalScans.toLocaleString()}</td>
                  <td>{creator.stats.totalPurchases.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
