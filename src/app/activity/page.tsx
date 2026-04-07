export default function ActivityPage() {
  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-title">Activity</div>
        <div className="page-subtitle">
          Full audit trail of everything Aegis has done
        </div>
      </div>
      <div className="card">
        <div className="empty-state">
          <div className="empty-state-title">No activity yet</div>
          <div className="empty-state-desc">
            Every action Aegis takes and every data change will be recorded here.
          </div>
        </div>
      </div>
    </div>
  )
}
