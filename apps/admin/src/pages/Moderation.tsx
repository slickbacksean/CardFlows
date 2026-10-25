import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi, type Report } from '../lib/api'

export function Moderation() {
  const queryClient = useQueryClient()

  const { data: reports, isLoading } = useQuery({
    queryKey: ['reports'],
    queryFn: () => adminApi.getReports(100, 0),
    refetchInterval: 30000,
  })

  const resolveMutation = useMutation({
    mutationFn: ({ reportId, action }: { reportId: string; action: string }) =>
      adminApi.resolveReport(reportId, action, true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports'] })
    },
  })

  function handleResolve(reportId: string, action: string) {
    if (confirm(`Resolve this report with action: ${action}?`)) {
      resolveMutation.mutate({ reportId, action })
    }
  }

  if (isLoading) {
    return <div>Loading...</div>
  }

  return (
    <div style={{ maxWidth: 1200 }}>
      <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '2rem' }}>Moderation Queue</h1>

      {reports?.reports.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>
          No pending reports
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {reports?.reports.map((report) => (
            <ReportCard
              key={report.reportId}
              report={report}
              onResolve={(action) => handleResolve(report.reportId, action)}
              resolving={resolveMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ReportCard({
  report,
  onResolve,
  resolving,
}: {
  report: Report
  onResolve: (action: string) => void
  resolving: boolean
}) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '0.75rem', padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
        <div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span style={{ background: 'var(--accent)', color: 'white', padding: '0.25rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.75rem', fontWeight: 700 }}>
              {report.targetType.toUpperCase()}
            </span>
            <span style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>
              {new Date(report.createdAt).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </span>
          </div>
          <div style={{ marginBottom: '0.5rem' }}>
            <strong>Reason:</strong> {report.reason}
          </div>
          {report.note && (
            <div style={{ color: 'var(--muted)', fontSize: '0.875rem', fontStyle: 'italic' }}>
              "{report.note}"
            </div>
          )}
          <div style={{ color: 'var(--muted)', fontSize: '0.75rem', fontFamily: 'monospace', marginTop: '0.5rem' }}>
            Target ID: {report.targetId}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button
          onClick={() => onResolve('dismiss')}
          disabled={resolving}
          style={{
            background: 'var(--card)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            padding: '0.5rem 1rem',
            borderRadius: '0.5rem',
            fontWeight: 600,
          }}
        >
          Dismiss
        </button>
        <button
          onClick={() => onResolve('warn')}
          disabled={resolving}
          style={{
            background: 'var(--card)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            padding: '0.5rem 1rem',
            borderRadius: '0.5rem',
            fontWeight: 600,
          }}
        >
          Warn
        </button>
        <button
          onClick={() => onResolve('remove')}
          disabled={resolving}
          style={{
            background: 'var(--destructive)',
            color: 'white',
            border: 'none',
            padding: '0.5rem 1rem',
            borderRadius: '0.5rem',
            fontWeight: 600,
          }}
        >
          Remove Content
        </button>
        <button
          onClick={() => onResolve('suspend')}
          disabled={resolving}
          style={{
            background: 'var(--destructive)',
            color: 'white',
            border: 'none',
            padding: '0.5rem 1rem',
            borderRadius: '0.5rem',
            fontWeight: 600,
          }}
        >
          Suspend User
        </button>
        <button
          onClick={() => onResolve('ban')}
          disabled={resolving}
          style={{
            background: 'var(--destructive)',
            color: 'white',
            border: 'none',
            padding: '0.5rem 1rem',
            borderRadius: '0.5rem',
            fontWeight: 600,
          }}
        >
          Ban User
        </button>
      </div>
    </div>
  )
}
