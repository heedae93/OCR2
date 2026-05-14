'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { API_BASE_URL } from '@/lib/api'

type UserType = 'A' | 'U'
type MaskingAccessLevel = 'masked' | 'original'

interface User {
  user_id: string
  username: string
  name: string
  email: string
  type: UserType
  permission_group: string
  permission_group_name: string
  masking_access_level: MaskingAccessLevel
  created_at: string | null
  last_login: string | null
}

interface PermissionGroup {
  group_key: string
  group_name: string
  masking_access_level: MaskingAccessLevel
}

interface UserFormState {
  username: string
  name: string
  email: string
  password: string
  type: UserType
  permission_group: string
}

const emptyForm: UserFormState = { username: '', name: '', email: '', password: '', type: 'U', permission_group: 'default' }

const maskingLabel: Record<MaskingAccessLevel, string> = { masked: '마스킹', original: '원본 보기' }
const roleLabel: Record<UserType, string> = { A: '관리자', U: '일반 사용자' }

const inputClass =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-text-primary-light shadow-sm placeholder:text-slate-400 [color-scheme:light] autofill:shadow-[inset_0_0_0_1000px_white] focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-400 dark:bg-white dark:text-text-primary-light dark:focus:bg-white'

export default function UsersPage() {
  const router = useRouter()
  const [users, setUsers] = useState<User[]>([])
  const [groups, setGroups] = useState<PermissionGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [form, setForm] = useState<UserFormState>(emptyForm)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<User | null>(null)
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = localStorage.getItem('user')
    if (!stored) { router.push('/login'); return }
    try {
      if (JSON.parse(stored).type !== 'A') { router.push('/'); return }
    } catch { router.push('/login'); return }
    void loadAll()
  }, [router])

  async function loadAll() {
    setLoading(true)
    setError('')
    try {
      const [usersRes, groupsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/admin/users`),
        fetch(`${API_BASE_URL}/api/admin/permission-groups`),
      ])
      if (!usersRes.ok) throw new Error('사용자 목록을 불러오지 못했습니다')
      if (!groupsRes.ok) throw new Error('그룹 목록을 불러오지 못했습니다')
      const [usersData, groupsData] = await Promise.all([usersRes.json(), groupsRes.json()])
      setUsers(usersData)
      setGroups(groupsData)
      setSelectedUserIds(prev => new Set([...prev].filter(id => usersData.some((user: User) => user.user_id === id))))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '데이터를 불러오는 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  function openCreate() {
    setSelectedUser(null)
    setForm({ ...emptyForm, permission_group: groups[0]?.group_key || 'default' })
    setFormError('')
    setModalMode('create')
  }

  function openEdit(user: User) {
    setSelectedUser(user)
    setForm({ username: user.username, name: user.name ?? '', email: user.email ?? '', password: '', type: user.type, permission_group: user.permission_group })
    setFormError('')
    setModalMode('edit')
  }

  async function submitUser(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    if (!form.name.trim()) { setFormError('이름을 입력해주세요.'); return }
    if (modalMode === 'create') {
      if (!form.username.trim()) { setFormError('아이디를 입력해주세요.'); return }
      if (!form.password.trim()) { setFormError('비밀번호를 입력해주세요.'); return }
    }
    setSaving(true)
    try {
      const payload = modalMode === 'create'
        ? form
        : { name: form.name, email: form.email, type: form.type, permission_group: form.permission_group, ...(form.password.trim() ? { password: form.password } : {}) }
      const res = await fetch(
        modalMode === 'create' ? `${API_BASE_URL}/api/admin/users` : `${API_BASE_URL}/api/admin/users/${selectedUser!.user_id}`,
        { method: modalMode === 'create' ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
      )
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.detail || '저장에 실패했습니다.') }
      setModalMode(null)
      await loadAll()
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : '저장 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/users/${deleteTarget.user_id}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.detail || '삭제에 실패했습니다.') }
      setDeleteTarget(null)
      await loadAll()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '삭제 중 오류가 발생했습니다.')
    } finally {
      setDeleting(false)
    }
  }

  function toggleUserSelection(userId: string) {
    setSelectedUserIds(prev => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  function toggleAllUsers() {
    setSelectedUserIds(prev => {
      if (prev.size === users.length) return new Set()
      return new Set(users.map(user => user.user_id))
    })
  }

  async function handleBulkDelete() {
    const selectedIds = [...selectedUserIds]
    if (selectedIds.length === 0) {
      alert('삭제할 사용자를 선택해주세요.')
      return
    }

    if (!confirm(`선택한 사용자 ${selectedIds.length}명을 삭제하시겠습니까?`)) return

    setDeleting(true)
    try {
      await Promise.all(selectedIds.map(async userId => {
        const res = await fetch(`${API_BASE_URL}/api/admin/users/${userId}`, { method: 'DELETE' })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error(d.detail || '사용자 삭제에 실패했습니다.')
        }
      }))
      setSelectedUserIds(new Set())
      await loadAll()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '삭제 중 오류가 발생했습니다.')
    } finally {
      setDeleting(false)
    }
  }

  function formatDate(v: string | null) {
    if (!v) return '-'
    return new Date(v).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  const allUsersSelected = users.length > 0 && selectedUserIds.size === users.length

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-50">
      <Sidebar />
      <div className="ml-64 mt-14 flex flex-col gap-6 p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-text-primary-light dark:text-text-primary-dark">사용자 관리</h1>
            <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">
              사용자를 등록하고 그룹 권한을 설정합니다
            </p>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="flex justify-end">
          <div className="flex items-center gap-2">
            <button
              onClick={openCreate}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90"
            >
              사용자 등록
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={deleting}
              className="rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deleting ? '삭제 중...' : '삭제'}
            </button>
          </div>
        </div>

        <section className="overflow-hidden rounded-2xl border border-border-light bg-white dark:border-border-dark dark:bg-white">
          {loading ? (
            <div className="flex items-center justify-center p-16">
              <span className="material-symbols-outlined animate-spin text-4xl text-primary">progress_activity</span>
            </div>
          ) : users.length === 0 ? (
            <div className="p-12 text-center text-text-secondary-light dark:text-text-secondary-dark">등록된 사용자가 없습니다.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-primary/20 bg-primary/10 dark:border-primary/20 dark:bg-primary/10">
                <tr>
                  <th className="w-12 px-4 py-3">
                    <button
                      type="button"
                      onClick={toggleAllUsers}
                      aria-checked={allUsersSelected}
                      aria-label="전체 사용자 선택"
                      className={`flex h-4 w-4 items-center justify-center rounded-sm border transition-colors ${
                        allUsersSelected
                          ? 'border-primary bg-primary text-white'
                          : 'border-primary bg-surface-light dark:bg-surface-dark'
                      }`}
                    >
                      {allUsersSelected && <span className="material-symbols-outlined text-[14px] leading-none">check</span>}
                    </button>
                  </th>
                  {['아이디', '이름', '이메일', '역할', '권한 그룹', '최근 로그인', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-text-secondary-light dark:text-text-secondary-dark">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light dark:divide-border-dark">
                {users.map(user => (
                  <tr
                    key={user.user_id}
                    onClick={() => openEdit(user)}
                    className="cursor-pointer transition-colors hover:bg-background-light dark:hover:bg-background-dark"
                  >
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleUserSelection(user.user_id)
                        }}
                        aria-checked={selectedUserIds.has(user.user_id)}
                        aria-label={`${user.name || user.username} 선택`}
                        className={`flex h-4 w-4 items-center justify-center rounded-sm border transition-colors ${
                          selectedUserIds.has(user.user_id)
                            ? 'border-primary bg-primary text-white'
                            : 'border-primary bg-surface-light dark:bg-surface-dark'
                        }`}
                      >
                        {selectedUserIds.has(user.user_id) && <span className="material-symbols-outlined text-[14px] leading-none">check</span>}
                      </button>
                    </td>
                    <td className="px-4 py-3 font-medium text-text-primary-light dark:text-text-primary-light">{user.username}</td>
                    <td className="px-4 py-3 text-text-primary-light dark:text-text-primary-light">{user.name || '-'}</td>
                    <td className="px-4 py-3 text-text-secondary-light dark:text-text-secondary-dark">{user.email || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold shadow-sm ${user.type === 'A' ? 'bg-rose-100 text-rose-700' : 'bg-primary/10 text-primary'}`}>
                        {roleLabel[user.type]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium text-text-primary-light dark:text-text-primary-dark">{user.permission_group_name}</span>
                        <span className={`text-xs font-medium ${user.masking_access_level === 'original' ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                          {maskingLabel[user.masking_access_level]}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-text-secondary-light dark:text-text-secondary-dark">{formatDate(user.last_login)}</td>
                    <td className="px-4 py-3" />
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {/* 사용자 등록/수정 모달 */}
      {modalMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-border-light bg-surface-light shadow-2xl dark:border-border-dark dark:bg-surface-dark">
            <div className="flex items-center justify-between border-b border-border-light px-6 py-4 dark:border-border-dark">
              <h2 className="text-lg font-bold text-text-primary-light">
                {modalMode === 'create' ? '사용자 등록' : '사용자 수정'}
              </h2>
              <button onClick={() => setModalMode(null)} className="rounded-lg p-1 hover:bg-black/5 dark:hover:bg-white/5">
                <span className="material-symbols-outlined text-text-secondary-light dark:text-text-secondary-dark">close</span>
              </button>
            </div>
            <form onSubmit={submitUser} className="grid grid-cols-2 gap-4 p-6">
              {modalMode === 'create' && (
                <div className="col-span-2 flex flex-col gap-1">
                  <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">아이디 *</label>
                  <input type="text" value={form.username} onChange={e => setForm(p => ({ ...p, username: e.target.value }))} className={inputClass} placeholder="로그인 아이디" />
                </div>
              )}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">이름 *</label>
                <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className={inputClass} placeholder="사용자 이름" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">이메일</label>
                <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} className={inputClass} placeholder="example@email.com" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">
                  {modalMode === 'create' ? '비밀번호 *' : '비밀번호'}
                </label>
                <input type="password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} className={inputClass} placeholder={modalMode === 'create' ? '비밀번호' : '변경 시에만 입력'} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">역할</label>
                <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value as UserType }))} className={inputClass}>
                  <option value="U">일반 사용자</option>
                  <option value="A">관리자</option>
                </select>
              </div>
              <div className="col-span-2 flex flex-col gap-1">
                <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">권한 그룹</label>
                <select value={form.permission_group} onChange={e => setForm(p => ({ ...p, permission_group: e.target.value }))} className={inputClass}>
                  {groups.map(g => (
                    <option key={g.group_key} value={g.group_key}>
                      {g.group_name} / {maskingLabel[g.masking_access_level]}
                    </option>
                  ))}
                </select>
              </div>
              {formError && <p className="col-span-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-500 dark:bg-red-500/10">{formError}</p>}
              <div className="col-span-2 flex gap-3 pt-2">
                <button type="button" onClick={() => setModalMode(null)} className="flex-1 rounded-xl border border-border-light px-4 py-2 text-text-primary-light transition-colors hover:bg-black/5 dark:border-border-dark dark:text-text-primary-dark dark:hover:bg-white/5">
                  취소
                </button>
                <button type="submit" className="flex-1 rounded-xl bg-primary px-4 py-2 font-medium text-white transition-colors hover:bg-primary/90">
                  {saving ? '저장 중...' : modalMode === 'create' ? '등록' : '저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 삭제 확인 모달 */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-border-light bg-surface-light p-6 shadow-2xl dark:border-border-dark dark:bg-surface-dark">
            <h2 className="text-lg font-bold text-text-primary-light">사용자 삭제</h2>
            <p className="mt-3 text-sm text-text-secondary-light dark:text-text-secondary-dark">
              <strong>{deleteTarget.name || deleteTarget.username}</strong> 사용자를 삭제합니다.<br />
              해당 사용자의 모든 작업과 설정이 함께 삭제됩니다.
            </p>
            <div className="mt-6 flex gap-3">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 rounded-xl border border-border-light px-4 py-2 text-text-primary-light hover:bg-black/5 dark:border-border-dark dark:text-text-primary-dark dark:hover:bg-white/5">취소</button>
              <button onClick={handleDelete} className="flex-1 rounded-xl bg-red-500 px-4 py-2 font-medium text-white hover:bg-red-600">
                {deleting ? '삭제 중...' : '삭제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
