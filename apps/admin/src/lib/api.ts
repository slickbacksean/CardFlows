const API_BASE = import.meta.env.VITE_API_URL || '';

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}

export interface DashboardStats {
  users: {
    totalUsers: number;
    verifiedUsers: number;
    newSignupsToday: number;
    newSignupsThisWeek: number;
    newSignupsThisMonth: number;
    dailyActiveUsers: number;
    weeklyActiveUsers: number;
    monthlyActiveUsers: number;
    d1Retention: number;
    d7Retention: number;
    d30Retention: number;
    signupsByDay: Array<{ date: string; count: number }>;
  };
  scans: {
    totalScans: number;
    scansToday: number;
    scansThisWeek: number;
    scansThisMonth: number;
    recognitionSuccessRate: number;
    cardsightUsageThisMonth: number;
    cardsightMonthlyCap: number;
    scansByDay: Array<{ date: string; count: number }>;
  };
  purchases: {
    totalPurchases: number;
    purchasesToday: number;
    purchasesThisWeek: number;
    purchasesThisMonth: number;
    totalCollectionValueCents: number;
    purchasesByDay: Array<{ date: string; count: number }>;
  };
  community: {
    totalPosts: number;
    postsToday: number;
    postsThisWeek: number;
    totalReactions: number;
    totalComments: number;
    pendingReports: number;
    postsByDay: Array<{ date: string; count: number }>;
  };
}

export interface Creator {
  creatorId: string;
  name: string;
  platform: string;
  handle: string;
  inviteCode: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface CreatorStats {
  signupsCount: number;
  verifiedSignupsCount: number;
  activatedUsersCount: number;
  d7RetainedCount: number;
  totalScans: number;
  totalPurchases: number;
  premiumConversions: number;
}

export interface Report {
  reportId: string;
  targetType: string;
  targetId: string;
  reason: string;
  note?: string;
  reporterUserId: string;
  createdAt: string;
  resolvedAt?: string;
  resolution?: string;
}

export interface AuditAction {
  actionId: string;
  adminUserId: string;
  actionType: string;
  targetType: string | null;
  targetId: string | null;
  detailsJson: string;
  createdAt: string;
}

export const adminApi = {
  getDashboardStats: () => apiFetch<DashboardStats>('/v1/admin/stats/dashboard'),
  
  listCreators: (includeArchived = false) =>
    apiFetch<{ creators: Creator[] }>(`/v1/admin/creators?includeArchived=${includeArchived}`),
  
  getCreatorLeaderboard: (sortBy: 'signups' | 'activated' | 'scans' | 'purchases' = 'signups', limit = 20) =>
    apiFetch<{ leaderboard: Array<Creator & { stats: CreatorStats }> }>(`/v1/admin/creators/leaderboard?sortBy=${sortBy}&limit=${limit}`),
  
  createCreator: (data: { name: string; platform: string; handle: string; notes?: string; inviteCode?: string }) =>
    apiFetch<{ creatorId: string; inviteCode: string }>('/v1/admin/creators', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  
  updateCreator: (creatorId: string, data: Partial<Pick<Creator, 'name' | 'platform' | 'handle' | 'notes'>>) =>
    apiFetch<{ success: boolean }>(`/v1/admin/creators/${creatorId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  
  archiveCreator: (creatorId: string) =>
    apiFetch<{ success: boolean }>(`/v1/admin/creators/${creatorId}`, {
      method: 'DELETE',
    }),
  
  getReports: (limit = 50, offset = 0) =>
    apiFetch<{ reports: Report[] }>(`/v1/community/admin/reports?limit=${limit}&offset=${offset}`),
  
  resolveReport: (reportId: string, action: string, notifyUser = true) =>
    apiFetch<{ success: boolean }>(`/v1/community/admin/reports/${reportId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ action, notifyUser }),
    }),
  
  getAuditLog: (limit = 100, offset = 0, adminUserId?: string, actionType?: string) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (adminUserId) params.set('adminUserId', adminUserId);
    if (actionType) params.set('actionType', actionType);
    return apiFetch<{ actions: AuditAction[] }>(`/v1/admin/audit-log?${params}`);
  },
};
