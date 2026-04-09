'use client'

import { useState } from 'react'
import EmployeesTab from './tabs/EmployeesTab'
import ShiftRequirementsTab from './tabs/ShiftRequirementsTab'
import TimeOffTab from './tabs/TimeOffTab'
import ConflictsTab from './tabs/ConflictsTab'

const TABS = [
  { id: 'employees',   label: 'Employees' },
  { id: 'shifts',      label: 'Shift Requirements' },
  { id: 'timeoff',     label: 'Time Off' },
  { id: 'conflicts',   label: 'Conflicts' },
]

export default function DataPage() {
  const [activeTab, setActiveTab] = useState('employees')

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-title">Data</div>
        <div className="page-subtitle">
          The source of truth Aegis reads from — keep this accurate
        </div>
      </div>

      <div style={{
        display: 'flex',
        gap: 2,
        borderBottom: '1px solid var(--border-subtle)',
        marginBottom: 24,
      }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '8px 18px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === tab.id
                ? '2px solid var(--accent)'
                : '2px solid transparent',
              color: activeTab === tab.id
                ? 'var(--text-primary)'
                : 'var(--text-muted)',
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              fontWeight: activeTab === tab.id ? 500 : 400,
              cursor: 'pointer',
              marginBottom: -1,
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'employees'  && <EmployeesTab />}
      {activeTab === 'shifts'     && <ShiftRequirementsTab />}
      {activeTab === 'timeoff'    && <TimeOffTab />}
      {activeTab === 'conflicts'  && <ConflictsTab />}
    </div>
  )
}