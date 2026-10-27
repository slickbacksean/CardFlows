import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminApi } from '../lib/api'

export function AuditLog() {
  const [filters, setFilters] = useState<{ actionType?: string; adminUserId?: string }>({})
  const [page, setPage] = useState(0)
  const limit = 100

  const { data: auditLog, isLoading } = useQuery({
    queryKey: ['audit-log', page, filters],
    queryFn: () => adminApi.getAuditLog(limit, page * limit, filters.adminUserId, filters.actionType),
  })

  return (
    <div style={{ maxWidth: 1200 }}>
      <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '2rem' }}>Audit Log</h1>

      <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '1rem' }}>
        <select
          value={filters.actionType || ''}
          onChange={(e) => setFilters({ ...filters, actionType: e.target.value || undefined })}
          style={{ flex: 1 }}
        >
          <option value="">All Action Types</option>
          <option value="report_resolve">Report Resolve</option>
          <option value="content_remove">Content Remove</option>
          <option value="user_suspend">User Suspend</option>
          <option value="user_ban">User Ban</option>
          <option value="creator_create">Creator Create</option>
          <option value="creator_update">Creator Update</option>
          <option value="creator_delete">Creator Delete</option>
          <option value="stats_export">Stats Export</option>
        </select>
        <input
          type="text"
          placeholder="Filter by admin user ID"
          value={filters.adminUserId || ''}
          onChange={(e) => setFilters({ ...filters, adminUserId: e.target.value || undefined })}
          style={{ flex: 1 }}
        />
      </div>

      {isLoading ? (
        <div>Loading...</div>
      ) : (
        <>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '0.75rem', overflow: 'hidden' }}>
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Admin User</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {auditLog?.actions.map((action) => {
                  const details = JSON.parse(action.detailsJson)
                  return (
                    <tr key={action.actionId}>
                      <td style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
                        {new Date(action.createdAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                        {action.adminUserId.substring(0, 12)}...
                      </td>
                      <td>
                        <span style={{
                          background: 'var(--accent)',
                          color: 'white',
                          padding: '0.25rem 0.5rem',
                          borderRadius: '0.25rem',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                        }}>
                          {action.actionType}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.875rem' }}>
                        {action.targetType && action.targetId ? (
                          <div style={{ fontFamily: 'monospace', color: 'var(--muted)' }}>
                            {action.targetType}: {action.targetId.substring(0, 12)}...
                          </div>
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>—</span>
                        )}
                      </td>
                      <td style={{ fontSize: '0.875rem' }}>
                        {Object.keys(details).length > 0 ? (
                          <details>
                            <summary style={{ cursor: 'pointer', color: 'var(--accent)' }}>View</summary>
                            <pre style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--muted)', whiteSpace: 'pre-wrap' }}>
                              {JSON.stringify(details, null, 2)}
                            </pre>
                          </details>
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'center', gap: '0.5rem' }}>
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              style={{
                background: 'var(--card)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                fontWeight: 600,
                opacity: page === 0 ? 0.5 : 1,
              }}
            >
              Previous
            </button>
            <span style={{ display: 'flex', alignItems: 'center', padding: '0 1rem', color: 'var(--muted)' }}>
              Page {page + 1}
            </span>
            <button
              onClick={() => setPage(page + 1)}
              disabled={!auditLog?.actions.length || auditLog.actions.length < limit}
              style={{
                background: 'var(--card)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                padding: '0.5rem 1rem',
                borderRadius: '0.5rem',
                fontWeight: 600,
                opacity: !auditLog?.actions.length || auditLog.actions.length < limit ? 0.5 : 1,
              }}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  )
}
