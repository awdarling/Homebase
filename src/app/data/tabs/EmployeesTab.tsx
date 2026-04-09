'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Employee } from '@/lib/types'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const ROLE_COLORS: Record<string, string> = {
  'Greeter':      '#3b82f6',
  'Lifeguard':    '#10b981',
  'Headguard':    '#f97316',
  'AsstManager':  '#8b5cf6',
  'Manager':      '#ef4444',
}

function RoleBadge({ role }: { role: string }) {
  const color = ROLE_COLORS[role] ?? '#666'
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 'var(--radius-pill)',
      fontSize: 11,
      fontWeight: 500,
      background: color + '22',
      color: color,
      border: `1px solid ${color}44`,
    }}>
      {role}
    </span>
  )
}

function InitialsAvatar({ name, role }: { name: string; role: string }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const color = ROLE_COLORS[role] ?? '#666'
  return (
    <div style={{
      width: 32,
      height: 32,
      borderRadius: 'var(--radius-sm)',
      background: color + '22',
      border: `1px solid ${color}44`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 11,
      fontWeight: 700,
      color: color,
      fontFamily: 'var(--font-display)',
      flexShrink: 0,
    }}>
      {initials}
    </div>
  )
}

export default function EmployeesTab() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [availability, setAvailability] = useState<Record<string, { day: number; start: string; end: string }[]>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null)
  const [form, setForm] = useState({
    name: '',
    primary_role: '',
    qualified_roles: '',
    max_weekly_hours: '40',
    contact_phone: '',
    contact_email: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const supabase = createClient()
  const COMPANY_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    setLoading(true)
    const [empRes, avRes] = await Promise.all([
      supabase.from('employees').select('*').eq('company_id', COMPANY_ID).order('primary_role').order('name'),
      supabase.from('availability').select('*').eq('company_id', COMPANY_ID),
    ])
    if (empRes.data) setEmployees(empRes.data)
    if (avRes.data) {
      const map: Record<string, { day: number; start: string; end: string }[]> = {}
      avRes.data.forEach((a: any) => {
        if (!map[a.employee_id]) map[a.employee_id] = []
        map[a.employee_id].push({ day: a.day_of_week, start: a.start_time, end: a.end_time })
      })
      setAvailability(map)
    }
    setLoading(false)
  }

  const roles = ['all', ...Array.from(new Set(employees.map(e => e.primary_role)))]

  const filtered = employees.filter(e => {
    const matchSearch = e.name.toLowerCase().includes(search.toLowerCase())
    const matchRole = roleFilter === 'all' || e.primary_role === roleFilter
    return matchSearch && matchRole
  })

  function openAdd() {
    setEditingEmployee(null)
    setForm({ name: '', primary_role: '', qualified_roles: '', max_weekly_hours: '40', contact_phone: '', contact_email: '' })
    setError('')
    setShowForm(true)
  }

  function openEdit(emp: Employee) {
    setEditingEmployee(emp)
    setForm({
      name: emp.name,
      primary_role: emp.primary_role,
      qualified_roles: emp.qualified_roles.join(', '),
      max_weekly_hours: String(emp.max_weekly_hours),
      contact_phone: emp.contact_phone ?? '',
      contact_email: emp.contact_email ?? '',
    })
    setError('')
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.name.trim() || !form.primary_role.trim()) {
      setError('Name and role are required.')
      return
    }
    setSaving(true)
    setError('')
    const payload = {
      company_id: COMPANY_ID,
      name: form.name.trim(),
      primary_role: form.primary_role.trim(),
      qualified_roles: form.qualified_roles.split(',').map(r => r.trim()).filter(Boolean),
      max_weekly_hours: parseInt(form.max_weekly_hours) || 40,
      contact_phone: form.contact_phone.trim() || null,
      contact_email: form.contact_email.trim() || null,
      active: true,
    }
    if (editingEmployee) {
      await supabase.from('employees').update(payload).eq('id', editingEmployee.id)
    } else {
      await supabase.from('employees').insert(payload)
    }
    setSaving(false)
    setShowForm(false)
    fetchData()
  }

  async function handleToggleActive(emp: Employee) {
    await supabase.from('employees').update({ active: !emp.active }).eq('id', emp.id)
    fetchData()
  }

  if (loading) return (
    <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      Loading employees...
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
        <input
          className="form-input"
          style={{ maxWidth: 240 }}
          placeholder="Search employees..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          className="form-select"
          style={{ maxWidth: 180 }}
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value)}
        >
          {roles.map(r => (
            <option key={r} value={r}>{r === 'all' ? 'All roles' : r}</option>
          ))}
        </select>
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn btn-primary btn-sm" onClick={openAdd}>
            + Add Employee
          </button>
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
        {filtered.length} employee{filtered.length !== 1 ? 's' : ''}
        {roleFilte