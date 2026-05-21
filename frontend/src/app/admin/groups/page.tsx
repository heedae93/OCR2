'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Tree from 'rc-tree'
import type { AllowDrop } from 'rc-tree/es/Tree'
import type { DataNode, EventDataNode } from 'rc-tree/es/interface'

import Sidebar from '@/components/Sidebar'
import { API_BASE_URL } from '@/lib/api'

type UserType = 'A' | 'U'

interface User {
  user_id: string
  username: string
  name: string
  email: string
  type: UserType
  permission_group: string
  permission_group_name: string
  masking_access_level: 'masked' | 'original'
  masking_field_keys: string[]
  total_jobs: number
  last_login: string | null
}

interface PermissionGroup {
  group_key: string
  group_name: string
  description: string | null
  masking_field_keys: string[]
  is_system: boolean
  user_count: number
}

interface CustomMaskingField {
  id: number
  field_key: string
  label: string
  pattern?: string | null
  description?: string | null
}

interface MaskingFieldOption {
  id: string
  field_key: string
  label: string
  source: 'default' | 'custom'
  customId?: number
}

type GroupTreeNode = DataNode & {
  key: string
  nodeType: 'group' | 'user'
  groupKey?: string
  isVirtualGroup?: boolean
  user?: User
  children?: GroupTreeNode[]
}

interface GroupFormState {
  group_key: string
  group_name: string
  description: string
}

interface FieldFormState {
  label: string
  pattern: string
  description: string
}

const UNASSIGNED_GROUP_KEY = '__unassigned__'

const inputClass =
  'w-full rounded-xl border border-border-light bg-background-light px-3 py-2 text-sm text-text-primary-light focus:outline-none focus:ring-2 focus:ring-primary/40 dark:border-border-dark dark:bg-background-dark dark:text-text-primary-dark'

const defaultFieldOptions: MaskingFieldOption[] = [
  { id: 'resident_registration_number', field_key: 'resident_registration_number', label: '주민등록번호', source: 'default' },
  { id: 'passport_number', field_key: 'passport_number', label: '여권번호', source: 'default' },
  { id: 'drivers_license_number', field_key: 'drivers_license_number', label: '운전면허번호', source: 'default' },
  { id: 'foreigner_registration_number', field_key: 'foreigner_registration_number', label: '외국인등록번호', source: 'default' },
  { id: 'phone_number', field_key: 'phone_number', label: '전화번호', source: 'default' },
  { id: 'bank_account_number', field_key: 'bank_account_number', label: '계좌번호', source: 'default' },
  { id: 'credit_card_number', field_key: 'credit_card_number', label: '신용카드번호', source: 'default' },
  { id: 'health_insurance_number', field_key: 'health_insurance_number', label: '건강보험번호', source: 'default' },
  { id: 'road_name_address', field_key: 'road_name_address', label: '도로명 주소', source: 'default' },
  { id: 'email_address', field_key: 'email_address', label: '이메일', source: 'default' },
  { id: 'vehicle_number', field_key: 'vehicle_number', label: '차량번호', source: 'default' },
  { id: 'business_registration_number', field_key: 'business_registration_number', label: '사업자등록번호', source: 'default' },
  { id: 'ip_mac_address', field_key: 'ip_mac_address', label: 'IP/MAC 주소', source: 'default' },
]
const emptyGroupForm: GroupFormState = {
  group_key: '',
  group_name: '',
  description: '',
}

const emptyFieldForm: FieldFormState = {
  label: '',
  pattern: '',
  description: '',
}

export default function GroupManagementPage() {
  const router = useRouter()
  const [currentUserId, setCurrentUserId] = useState('')
  const [users, setUsers] = useState<User[]>([])
  const [groups, setGroups] = useState<PermissionGroup[]>([])
  const [customFields, setCustomFields] = useState<CustomMaskingField[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingUserId, setSavingUserId] = useState<string | null>(null)
  const [savingGroupKey, setSavingGroupKey] = useState<string | null>(null)
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([])
  const [selectedTreeKey, setSelectedTreeKey] = useState<string>(UNASSIGNED_GROUP_KEY)
  const [draggingUserId, setDraggingUserId] = useState<string | null>(null)
  const [localFieldKeys, setLocalFieldKeys] = useState<string[]>([])

  const [groupModalMode, setGroupModalMode] = useState<'create' | 'edit' | null>(null)
  const [selectedGroup, setSelectedGroup] = useState<PermissionGroup | null>(null)
  const [groupForm, setGroupForm] = useState<GroupFormState>(emptyGroupForm)
  const [groupFormError, setGroupFormError] = useState('')
  const [savingGroup, setSavingGroup] = useState(false)
  const [deleteTargetGroup, setDeleteTargetGroup] = useState<PermissionGroup | null>(null)
  const [deletingGroup, setDeletingGroup] = useState(false)

  const [fieldModalMode, setFieldModalMode] = useState<'create' | 'edit' | null>(null)
  const [selectedField, setSelectedField] = useState<CustomMaskingField | null>(null)
  const [fieldForm, setFieldForm] = useState<FieldFormState>(emptyFieldForm)
  const [fieldFormError, setFieldFormError] = useState('')
  const [savingField, setSavingField] = useState(false)
  const [deletingFieldId, setDeletingFieldId] = useState<number | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = localStorage.getItem('user')
    if (!stored) {
      router.push('/login')
      return
    }

    try {
      const user = JSON.parse(stored)
      if (user.type !== 'A') {
        router.push('/')
        return
      }
      setCurrentUserId(user.user_id ?? '')
      void loadAll(user.user_id ?? '')
    } catch {
      router.push('/login')
    }
  }, [router])

  async function loadAll(userId: string) {
    setLoading(true)
    setError('')

    try {
      const [usersRes, groupsRes, customFieldsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/admin/users`),
        fetch(`${API_BASE_URL}/api/admin/permission-groups`),
        fetch(`${API_BASE_URL}/api/metadata-v3/custom-fields?user_id=${encodeURIComponent(userId)}`),
      ])

      if (!usersRes.ok) throw new Error('사용자 목록을 불러오지 못했습니다')
      if (!groupsRes.ok) throw new Error('그룹 목록을 불러오지 못했습니다')
      if (!customFieldsRes.ok) throw new Error('커스텀 필드 목록을 불러오지 못했습니다')

      const [usersData, groupsData, customFieldsData] = await Promise.all([
        usersRes.json(),
        groupsRes.json(),
        customFieldsRes.json(),
      ])

      setUsers(usersData)
      setGroups(groupsData)
      setCustomFields(customFieldsData)
      setExpandedKeys(prev => {
        const next = [...prev]
        if (!next.includes(UNASSIGNED_GROUP_KEY)) next.push(UNASSIGNED_GROUP_KEY)
        for (const group of groupsData as PermissionGroup[]) {
          if (!next.includes(group.group_key)) next.push(group.group_key)
        }
        return next
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '데이터를 불러오는 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const fieldOptions = useMemo<MaskingFieldOption[]>(() => {
    const customOptions = customFields.map(field => ({
      id: `custom:${field.id}`,
      field_key: field.field_key,
      label: field.label,
      source: 'custom' as const,
      customId: field.id,
    }))
    return [...defaultFieldOptions, ...customOptions]
  }, [customFields])

  const unassignedUsers = useMemo(() => users.filter(user => !user.permission_group), [users])

  const treeData = useMemo<GroupTreeNode[]>(() => {
    const unassignedNode: GroupTreeNode = {
      key: UNASSIGNED_GROUP_KEY,
      title: '미배정 사용자',
      nodeType: 'group',
      groupKey: '',
      isVirtualGroup: true,
      children: unassignedUsers.map(user => ({
        key: `user:${user.user_id}`,
        title: user.name || user.username,
        nodeType: 'user',
        groupKey: '',
        user,
        isLeaf: true,
      })),
    }

    const groupNodes = groups.map(group => ({
      key: group.group_key,
      title: group.group_name,
      nodeType: 'group' as const,
      groupKey: group.group_key,
      children: users
        .filter(user => user.permission_group === group.group_key)
        .map(user => ({
          key: `user:${user.user_id}`,
          title: user.name || user.username,
          nodeType: 'user' as const,
          groupKey: group.group_key,
          user,
          isLeaf: true,
        })),
    }))

    return [unassignedNode, ...groupNodes]
  }, [groups, unassignedUsers, users])

  const selectedGroupDetail = useMemo(() => {
    if (!selectedTreeKey || selectedTreeKey === UNASSIGNED_GROUP_KEY) return null
    return groups.find(group => group.group_key === selectedTreeKey) ?? null
  }, [groups, selectedTreeKey])

  async function assignUserToGroup(user: User, nextGroupKey: string) {
    if ((user.permission_group || '') === nextGroupKey) return

    setSavingUserId(user.user_id)
    setError('')

    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/users/${user.user_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permission_group: nextGroupKey }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || '그룹 변경에 실패했습니다.')
      }

      const updatedUser = await res.json()
      setUsers(prev => prev.map(item => (item.user_id === updatedUser.user_id ? updatedUser : item)))
      await loadGroupsOnly()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '그룹 변경 중 오류가 발생했습니다.')
    } finally {
      setSavingUserId(null)
      setDraggingUserId(null)
    }
  }

  async function loadGroupsOnly() {
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/permission-groups`)
      if (!res.ok) return
      const groupsData = await res.json()
      setGroups(groupsData)
    } catch {
      // ignore
    }
  }

  function openCreateGroup() {
    setSelectedGroup(null)
    setGroupForm(emptyGroupForm)
    setGroupFormError('')
    setGroupModalMode('create')
  }

  function openEditGroup(group: PermissionGroup) {
    setSelectedGroup(group)
    setGroupForm({
      group_key: group.group_key,
      group_name: group.group_name,
      description: group.description ?? '',
    })
    setGroupFormError('')
    setGroupModalMode('edit')
  }

  function closeGroupModal() {
    if (savingGroup) return
    setGroupModalMode(null)
    setSelectedGroup(null)
    setGroupForm(emptyGroupForm)
    setGroupFormError('')
  }

  async function submitGroup(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setGroupFormError('')

    const groupKey = groupForm.group_key.trim()
    const groupName = groupForm.group_name.trim()
    const description = groupForm.description.trim()

    if (!groupName) {
      setGroupFormError('그룹명을 입력해주세요.')
      return
    }

    if (groupModalMode === 'create' && !groupKey) {
      setGroupFormError('그룹 키를 입력해주세요.')
      return
    }

    setSavingGroup(true)

    try {
      const url =
        groupModalMode === 'create'
          ? `${API_BASE_URL}/api/admin/permission-groups`
          : `${API_BASE_URL}/api/admin/permission-groups/${selectedGroup!.group_key}`

      const payload =
        groupModalMode === 'create'
          ? {
              group_key: groupKey,
              group_name: groupName,
              description,
              masking_access_level: 'masked',
              masking_field_keys: [],
            }
          : {
              group_name: groupName,
              description,
            }

      const res = await fetch(url, {
        method: groupModalMode === 'create' ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || '그룹 저장에 실패했습니다.')
      }

      closeGroupModal()
      await loadAll(currentUserId)
    } catch (e: unknown) {
      setGroupFormError(e instanceof Error ? e.message : '그룹 저장 중 오류가 발생했습니다.')
    } finally {
      setSavingGroup(false)
    }
  }

  async function handleDeleteGroup() {
    if (!deleteTargetGroup) return

    setDeletingGroup(true)
    setError('')

    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/permission-groups/${deleteTargetGroup.group_key}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || '그룹 삭제에 실패했습니다.')
      }

      setDeleteTargetGroup(null)
      if (selectedTreeKey === deleteTargetGroup.group_key) {
        setSelectedTreeKey(UNASSIGNED_GROUP_KEY)
      }
      await loadAll(currentUserId)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '그룹 삭제 중 오류가 발생했습니다.')
    } finally {
      setDeletingGroup(false)
    }
  }

  function openCreateField() {
    setSelectedField(null)
    setFieldForm(emptyFieldForm)
    setFieldFormError('')
    setFieldModalMode('create')
  }

  function openEditField(field: CustomMaskingField) {
    setSelectedField(field)
    setFieldForm({
      label: field.label ?? '',
      pattern: field.pattern ?? '',
      description: field.description ?? '',
    })
    setFieldFormError('')
    setFieldModalMode('edit')
  }

  function closeFieldModal() {
    if (savingField) return
    setFieldModalMode(null)
    setSelectedField(null)
    setFieldForm(emptyFieldForm)
    setFieldFormError('')
  }

  async function submitField(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!currentUserId) return

    const label = fieldForm.label.trim()
    if (!label) {
      setFieldFormError('항목명을 입력해주세요.')
      return
    }

    setSavingField(true)
    setFieldFormError('')

    try {
      const baseUrl = `${API_BASE_URL}/api/metadata-v3/custom-fields`
      const url =
        fieldModalMode === 'create'
          ? `${baseUrl}?user_id=${encodeURIComponent(currentUserId)}`
          : `${baseUrl}/${selectedField!.id}?user_id=${encodeURIComponent(currentUserId)}`

      const res = await fetch(url, {
        method: fieldModalMode === 'create' ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label,
          pattern: fieldForm.pattern.trim() || null,
          description: fieldForm.description.trim() || null,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || '커스텀 필드 저장에 실패했습니다.')
      }

      closeFieldModal()
      await loadAll(currentUserId)
    } catch (e: unknown) {
      setFieldFormError(e instanceof Error ? e.message : '커스텀 필드 저장 중 오류가 발생했습니다.')
    } finally {
      setSavingField(false)
    }
  }

  async function handleDeleteField(field: CustomMaskingField) {
    if (!currentUserId) return

    setDeletingFieldId(field.id)
    setError('')

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/metadata-v3/custom-fields/${field.id}?user_id=${encodeURIComponent(currentUserId)}`,
        { method: 'DELETE' },
      )

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || '커스텀 필드 삭제에 실패했습니다.')
      }

      const removedKey = field.field_key
      setGroups(prev =>
        prev.map(group => ({
          ...group,
          masking_field_keys: group.masking_field_keys.filter(key => key !== removedKey),
        })),
      )

      await Promise.all(
        groups
          .filter(group => group.masking_field_keys.includes(removedKey))
          .map(group =>
            fetch(`${API_BASE_URL}/api/admin/permission-groups/${group.group_key}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                group_name: group.group_name,
                description: group.description ?? '',
                masking_field_keys: group.masking_field_keys.filter(key => key !== removedKey),
              }),
            }),
          ),
      )

      await loadAll(currentUserId)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '커스텀 필드 삭제 중 오류가 발생했습니다.')
    } finally {
      setDeletingFieldId(null)
    }
  }

  useEffect(() => {
    setLocalFieldKeys(selectedGroupDetail ? [...selectedGroupDetail.masking_field_keys] : [])
  }, [selectedGroupDetail])

  async function saveGroupFieldKeys() {
    if (!selectedGroupDetail) return

    setSavingGroupKey(selectedGroupDetail.group_key)
    setError('')

    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/permission-groups/${selectedGroupDetail.group_key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_name: selectedGroupDetail.group_name,
          description: selectedGroupDetail.description ?? '',
          masking_field_keys: localFieldKeys,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || '그룹 권한 저장에 실패했습니다.')
      }

      const updatedGroup = await res.json()
      setGroups(prev => prev.map(item => (item.group_key === updatedGroup.group_key ? updatedGroup : item)))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '그룹 권한 저장 중 오류가 발생했습니다.')
    } finally {
      setSavingGroupKey(null)
    }
  }

  const allowDrop: AllowDrop<GroupTreeNode> = ({ dropNode, dropPosition }) => {
    return dropNode.nodeType === 'group' && dropPosition === 0
  }

  function handleSelect(_keys: React.Key[], info: { node: EventDataNode<GroupTreeNode> }) {
    if (info.node.nodeType === 'group') {
      setSelectedTreeKey(String(info.node.key))
      return
    }
    setSelectedTreeKey(info.node.groupKey || UNASSIGNED_GROUP_KEY)
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-50">
      <Sidebar />
      <div className="ml-64 flex flex-col gap-6 p-8">
        <div>
          <h1 className="text-2xl font-bold text-text-primary-light">그룹관리</h1>
          <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">
            사용자를 그룹에 드래그하거나 커스텀 마스킹 항목을 추가·수정할 수 있습니다.
          </p>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="grid min-h-[calc(100vh-230px)] grid-cols-1 items-stretch gap-6 xl:grid-cols-[1.05fr_1fr]">
          <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border-light bg-surface-light dark:border-border-dark dark:bg-surface-dark">
            <div className="min-h-[96px] border-b border-border-light px-4 py-3 dark:border-border-dark">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-text-primary-light">그룹 트리</h2>
                <button
                  onClick={openCreateGroup}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary/90"
                >
                  그룹 생성
                </button>
              </div>
              <p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
                사용자를 그룹으로 드래그하여 이동하거나 그룹을 선택하여 마스킹 항목을 설정할 수 있습니다.
              </p>
            </div>

            {loading ? (
              <LoadingPanel />
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto bg-white p-3 dark:bg-white">
                <Tree<GroupTreeNode>
                  className="group-tree"
                  showLine
                  selectable
                  selectedKeys={[selectedTreeKey]}
                  switcherIcon={node =>
                    node.isLeaf ? (
                      <span className="group-tree-spacer" />
                    ) : (
                      <span className="group-tree-toggle">{node.expanded ? '-' : '+'}</span>
                    )
                  }
                  draggable={{
                    icon: false,
                    nodeDraggable: node => (node as GroupTreeNode).nodeType === 'user',
                  }}
                  allowDrop={allowDrop}
                  expandedKeys={expandedKeys}
                  treeData={treeData}
                  onExpand={keys => setExpandedKeys(keys)}
                  onSelect={handleSelect}
                  onDragStart={({ node }) => {
                    if (node.nodeType === 'user' && typeof node.key === 'string') {
                      setDraggingUserId(node.key.replace('user:', ''))
                    }
                  }}
                  onDragEnd={() => setDraggingUserId(null)}
                  onDrop={({ dragNode, node, dropToGap }) => {
                    if (dropToGap) return
                    if (dragNode.nodeType !== 'user' || node.nodeType !== 'group' || !dragNode.user) return
                    void assignUserToGroup(dragNode.user, node.groupKey ?? '')
                  }}
                  titleRender={node =>
                    node.nodeType === 'group' ? (
                      <GroupTitle
                        group={groups.find(group => group.group_key === node.groupKey) ?? null}
                        title={typeof node.title === 'string' ? node.title : '그룹'}
                        count={node.children?.length ?? 0}
                        isDropActive={draggingUserId !== null}
                        isVirtualGroup={Boolean(node.isVirtualGroup)}
                        isSelected={selectedTreeKey === node.key}
                        onSelect={() => setSelectedTreeKey(String(node.key))}
                        onDropUser={() => {
                          const draggedUser = users.find(user => user.user_id === draggingUserId)
                          if (draggedUser) {
                            void assignUserToGroup(draggedUser, node.groupKey ?? '')
                          }
                        }}
                        onEdit={() => {
                          const targetGroup = groups.find(group => group.group_key === node.groupKey)
                          if (targetGroup) openEditGroup(targetGroup)
                        }}
                        onDelete={() => {
                          const targetGroup = groups.find(group => group.group_key === node.groupKey)
                          if (targetGroup) setDeleteTargetGroup(targetGroup)
                        }}
                      />
                    ) : (
                      <UserNodeTitle
                        user={node.user!}
                        isSaving={savingUserId === node.user?.user_id}
                      />
                    )
                  }
                />
              </div>
            )}
          </section>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border-light bg-surface-light dark:border-border-dark dark:bg-surface-dark">
            <div className="min-h-[96px] border-b border-border-light px-5 py-3 dark:border-border-dark">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-text-primary-light">
                  {selectedTreeKey === UNASSIGNED_GROUP_KEY ? '개인정보 항목' : selectedGroupDetail?.group_name ?? '그룹 권한'}
                </h2>
              </div>
              <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">
                {selectedTreeKey === UNASSIGNED_GROUP_KEY
                  ? '기본 13개 항목과 커스텀 항목을 확인하고 추가/수정/삭제할 수 있습니다.'
                  : '선택한 그룹에 마스킹할 커스텀 항목을 체크하고 변경사항을 저장할 수 있습니다.'}
              </p>
            </div>

            {loading ? (
              <LoadingPanel />
            ) : selectedTreeKey === UNASSIGNED_GROUP_KEY ? (
              <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">
                    총 <span className="font-bold text-primary">{fieldOptions.length}</span>개 항목
                  </div>
                  <button
                    onClick={openCreateField}
                    className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary/90"
                  >
                    항목 추가
                  </button>
                </div>

                <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto bg-white p-3 pr-2 dark:bg-white sm:grid-cols-2">
                  {fieldOptions.map(field => (
                    <div
                      key={field.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border-light bg-white px-3 py-3 shadow-sm dark:border-border-light dark:bg-white"
                    >
                      <label className="flex min-w-0 items-center gap-3">
                        <input type="checkbox" checked readOnly className="h-4 w-4 rounded accent-emerald-600" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-text-primary-light dark:text-text-primary-dark">
                            {field.label}
                          </div>
                          <div className="truncate text-xs text-text-secondary-light dark:text-text-secondary-dark">
                            {field.source === 'default' ? '기본 항목' : field.field_key}
                          </div>
                        </div>
                      </label>

                      {field.source === 'custom' ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            onClick={() => {
                              const target = customFields.find(item => item.id === field.customId)
                              if (target) openEditField(target)
                            }}
                            className="rounded p-1 text-text-secondary-light transition-colors hover:bg-black/5 hover:text-primary dark:text-text-secondary-dark dark:hover:bg-white/5"
                            title="항목 수정"
                          >
                            <span className="material-symbols-outlined text-[18px]">edit</span>
                          </button>
                          <button
                            onClick={() => {
                              const target = customFields.find(item => item.id === field.customId)
                              if (target) void handleDeleteField(target)
                            }}
                            disabled={deletingFieldId === field.customId}
                            className="rounded p-1 text-text-secondary-light transition-colors hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-60 dark:text-text-secondary-dark dark:hover:bg-red-500/10"
                            title="항목 삭제"
                          >
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                          </button>
                        </div>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-700 dark:bg-slate-100 dark:text-slate-700">
                          기본
                        </span>
                      )}
                    </div>
                  ))}
                </div>

              </div>
            ) : selectedGroupDetail ? (
              <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
                <div className="rounded-xl border border-border-light bg-background-light px-4 py-3 dark:border-border-dark dark:bg-background-dark">
                  <div className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                    {selectedGroupDetail.group_name}
                  </div>
                  <div className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
                    {selectedGroupDetail.description || '설명 없음'}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">
                    총 <span className="font-bold text-primary">{fieldOptions.length}</span>개 항목
                  </div>
                  <button
                    onClick={() => void saveGroupFieldKeys()}
                    disabled={savingGroupKey === selectedGroupDetail.group_key}
                    className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed"
                  >
                    {savingGroupKey === selectedGroupDetail.group_key ? '저장 중...' : '저장'}
                  </button>
                </div>

                <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                  {fieldOptions.map(field => {
                    const checked = localFieldKeys.includes(field.field_key)
                    return (
                      <label
                        key={field.id}
                        className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-sm transition-colors ${
                          checked
                            ? 'border-emerald-500 bg-emerald-50 text-text-primary-light dark:border-emerald-500 dark:bg-emerald-50 dark:text-text-primary-light'
                            : 'border-border-light bg-background-light text-text-primary-light hover:bg-black/5 dark:border-border-dark dark:bg-background-dark dark:text-text-primary-dark dark:hover:bg-white/5'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setLocalFieldKeys(prev =>
                              prev.includes(field.field_key)
                                ? prev.filter(k => k !== field.field_key)
                                : [...prev, field.field_key],
                            )
                          }
                          disabled={savingGroupKey === selectedGroupDetail.group_key}
                          className="h-4 w-4 rounded accent-emerald-600 focus:ring-emerald-500/40"
                        />
                        <div className="min-w-0">
                          <div className="truncate">{field.label}</div>
                          <div className="truncate text-xs text-text-secondary-light dark:text-text-secondary-dark">
                            {field.source === 'default' ? '기본 항목' : '사용자 정의 항목'}
                          </div>
                        </div>
                      </label>
                    )
                  })}
                </div>

                <div className="flex items-center justify-end gap-3">
                  <div className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                    {localFieldKeys.length}개 항목 선택됨
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-6 text-sm text-text-secondary-light dark:text-text-secondary-dark">
                그룹을 선택하면 마스킹 커스텀 항목을 설정할 수 있습니다.
              </div>
            )}
          </section>
        </div>
      </div>

      {groupModalMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-border-light bg-surface-light shadow-2xl dark:border-border-dark dark:bg-surface-dark">
            <div className="flex items-center justify-between border-b border-border-light px-6 py-4 dark:border-border-dark">
              <h2 className="text-lg font-bold text-text-primary-light">
                {groupModalMode === 'create' ? '그룹 생성' : '그룹 수정'}
              </h2>
              <button
                onClick={closeGroupModal}
                className="rounded-lg p-1 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              >
                <span className="material-symbols-outlined text-text-secondary-light dark:text-text-secondary-dark">close</span>
              </button>
            </div>

            <form onSubmit={submitGroup} className="space-y-4 p-6">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">그룹명</label>
                <input
                  value={groupForm.group_name}
                  onChange={e => setGroupForm(prev => ({ ...prev, group_name: e.target.value }))}
                  className={inputClass}
                  placeholder="예: 법무팀"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">그룹 키</label>
                <input
                  value={groupForm.group_key}
                  onChange={e => setGroupForm(prev => ({ ...prev, group_key: e.target.value }))}
                  className={`${inputClass} ${groupModalMode === 'edit' ? 'opacity-70' : ''}`}
                  placeholder="예: counsel-admin"
                  disabled={groupModalMode === 'edit'}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">설명</label>
                <textarea
                  value={groupForm.description}
                  onChange={e => setGroupForm(prev => ({ ...prev, description: e.target.value }))}
                  className={`${inputClass} min-h-[96px] resize-none`}
                  placeholder="그룹 설명을 입력하세요"
                />
              </div>

              {groupFormError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                  {groupFormError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeGroupModal}
                  className="rounded-xl border border-border-light px-4 py-2 text-sm font-medium text-text-primary-light transition-colors hover:bg-black/5 dark:border-border-dark dark:text-text-primary-dark dark:hover:bg-white/5"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={savingGroup}
                  className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingGroup ? '저장 중...' : groupModalMode === 'create' ? '그룹 생성' : '수정 저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {fieldModalMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-border-light bg-surface-light shadow-2xl dark:border-border-dark dark:bg-surface-dark">
            <div className="flex items-center justify-between border-b border-border-light px-6 py-4 dark:border-border-dark">
              <h2 className="text-lg font-bold text-text-primary-light">
                {fieldModalMode === 'create' ? '항목 추가' : '항목 수정'}
              </h2>
              <button
                onClick={closeFieldModal}
                className="rounded-lg p-1 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              >
                <span className="material-symbols-outlined text-text-secondary-light dark:text-text-secondary-dark">close</span>
              </button>
            </div>

            <form onSubmit={submitField} className="space-y-4 p-6">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">항목명</label>
                <input
                  value={fieldForm.label}
                  onChange={e => setFieldForm(prev => ({ ...prev, label: e.target.value }))}
                  className={inputClass}
                  placeholder="예: 사번"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">패턴</label>
                <input
                  value={fieldForm.pattern}
                  onChange={e => setFieldForm(prev => ({ ...prev, pattern: e.target.value }))}
                  className={inputClass}
                  placeholder="정규식 패턴"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">설명</label>
                <textarea
                  value={fieldForm.description}
                  onChange={e => setFieldForm(prev => ({ ...prev, description: e.target.value }))}
                  className={`${inputClass} min-h-[88px] resize-none`}
                  placeholder="항목 설명을 입력하세요"
                />
              </div>

              {fieldFormError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                  {fieldFormError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeFieldModal}
                  className="rounded-xl border border-border-light px-4 py-2 text-sm font-medium text-text-primary-light transition-colors hover:bg-black/5 dark:border-border-dark dark:text-text-primary-dark dark:hover:bg-white/5"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={savingField}
                  className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingField ? '저장 중...' : fieldModalMode === 'create' ? '항목 생성' : '수정 저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTargetGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border-light bg-surface-light shadow-2xl dark:border-border-dark dark:bg-surface-dark">
            <div className="border-b border-border-light px-6 py-4 dark:border-border-dark">
              <h2 className="text-lg font-bold text-text-primary-light">그룹 삭제</h2>
            </div>

            <div className="space-y-3 px-6 py-5">
              <p className="text-sm text-text-primary-light dark:text-text-primary-dark">
                <span className="font-semibold">{deleteTargetGroup.group_name}</span> 그룹을 삭제하시겠습니까?
              </p>
              <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
                소속된 사용자는 그룹 없음 상태가 되고 그룹 설정이 함께 삭제됩니다.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border-light px-6 py-4 dark:border-border-dark">
              <button
                onClick={() => setDeleteTargetGroup(null)}
                className="rounded-xl border border-border-light px-4 py-2 text-sm font-medium text-text-primary-light transition-colors hover:bg-black/5 dark:border-border-dark dark:text-text-primary-dark dark:hover:bg-white/5"
              >
                취소
              </button>
              <button
                onClick={() => void handleDeleteGroup()}
                disabled={deletingGroup}
                className="rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deletingGroup ? '삭제 중...' : '삭제'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .group-tree.rc-tree {
          color: inherit;
          font-size: 13px;
          line-height: 1.2;
          font-family: 'Segoe UI', 'Malgun Gothic', sans-serif;
        }

        .group-tree .rc-tree-treenode {
          padding: 0;
        }

        .group-tree .rc-tree-node-content-wrapper {
          width: 100%;
          padding: 0;
          background: transparent !important;
        }

        .group-tree .rc-tree-switcher {
          width: 20px;
          min-width: 20px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #6b7280;
        }

        .group-tree .rc-tree-indent-unit {
          width: 22px;
        }

        .group-tree .rc-tree-draggable-icon {
          display: none;
        }

        .group-tree .rc-tree-node-selected > .rc-tree-node-content-wrapper,
        .group-tree .rc-tree-node-content-wrapper:hover {
          background: transparent !important;
        }

        .group-tree-toggle {
          display: inline-flex;
          width: 14px;
          height: 14px;
          align-items: center;
          justify-content: center;
          border: 1px solid #94a3b8;
          border-radius: 3px;
          background: #ffffff;
          color: #475569;
          font-size: 11px;
          font-weight: 700;
          line-height: 1;
        }

        .dark .group-tree-toggle {
          background: #ffffff;
          border-color: #94a3b8;
          color: #475569;
        }

        .group-tree-spacer {
          display: inline-block;
          width: 14px;
          height: 14px;
        }

        .group-tree-user-row {
          position: relative;
        }

        .group-tree-user-row::before {
          content: '';
          position: absolute;
          left: 2px;
          top: 50%;
          width: 12px;
          border-top: 1px solid #94a3b8;
          transform: translateY(-50%);
        }

        .dark .group-tree-user-row::before {
          border-top-color: #94a3b8;
        }
      `}</style>
    </div>
  )
}

function LoadingPanel() {
  return (
    <div className="flex items-center justify-center p-16">
      <span className="material-symbols-outlined animate-spin text-4xl text-primary">progress_activity</span>
    </div>
  )
}

function GroupTitle({
  group,
  title,
  count,
  isDropActive,
  isVirtualGroup,
  isSelected,
  onSelect,
  onDropUser,
  onEdit,
  onDelete,
}: {
  group: PermissionGroup | null
  title: string
  count: number
  isDropActive: boolean
  isVirtualGroup: boolean
  isSelected: boolean
  onSelect: () => void
  onDropUser: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div
      onClick={e => {
        e.preventDefault()
        e.stopPropagation()
        onSelect()
      }}
      onDragOver={e => {
        if (isDropActive) e.preventDefault()
      }}
      onDrop={e => {
        e.preventDefault()
        onDropUser()
      }}
      className={`flex items-center justify-between gap-2 rounded-md px-1.5 py-1 ${
        isSelected ? 'bg-primary/10' : isDropActive ? 'bg-primary/5' : ''
      }`}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="material-symbols-outlined text-[16px] leading-none text-violet-600">
          {isVirtualGroup ? 'group_off' : 'account_tree'}
        </span>
        <span className="truncate text-[13px] font-medium text-text-primary-light dark:text-text-primary-dark">{title}</span>
        <span className="shrink-0 text-[11px] text-text-secondary-light dark:text-text-secondary-dark">({count})</span>
      </div>

      {!isVirtualGroup && (
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              onEdit()
            }}
            className="rounded p-1 text-primary transition-colors hover:bg-primary/10 dark:text-primary dark:hover:bg-primary/10"
            title="그룹 수정"
          >
            <span className="material-symbols-outlined text-[16px] leading-none">edit</span>
          </button>
          <button
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              onDelete()
            }}
            className="rounded p-1 text-red-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-red-500 dark:hover:bg-red-500/10"
            title={group?.is_system ? '시스템 그룹은 삭제할 수 없습니다.' : '그룹 삭제'}
          >
            <span className="material-symbols-outlined text-[16px] leading-none">delete</span>
          </button>
        </div>
      )}
    </div>
  )
}

function UserNodeTitle({
  user,
  isSaving,
}: {
  user: User
  isSaving: boolean
}) {
  return (
    <div className="group-tree-user-row flex items-center justify-between gap-2 rounded-sm px-1 py-0.5 cursor-grab active:cursor-grabbing">
      <div className="flex min-w-0 items-center gap-1.5 pl-3">
        <span className="material-symbols-outlined text-[16px] leading-none text-emerald-600">person</span>
        <span className="truncate text-[13px] text-text-primary-light dark:text-text-primary-dark">
          {user.name || user.username}
        </span>
        <span className="truncate text-[11px] text-text-secondary-light dark:text-text-secondary-dark">
          {user.username}
        </span>
      </div>
      {isSaving && (
        <span className="text-[10px] font-bold text-primary">...</span>
      )}
    </div>
  )
}
