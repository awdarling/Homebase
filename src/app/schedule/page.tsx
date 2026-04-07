export default function SchedulePage() {
  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-title">Schedule</div>
        <div className="page-subtitle">
          Weekly schedules built by Aegis
        </div>
      </div>
      <div className="card">
        <div className="empty-state">
          <div className="empty-state-title">No schedule yet</div>
          <div className="empty-state-desc">
            When Aegis builds a schedule, it will appear here for your review.
          </div>
        </div>
      </div>
    </div>
  )
}
