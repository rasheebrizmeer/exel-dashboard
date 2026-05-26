// js/dashboard.js

// ============ ACTIVITY FEED ============
let activityChannel = null;

function startActivityFeed() {
  loadActivityFeed();

  activityChannel = supabase
    .channel('activity-feed')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_log' },
      async () => { await loadActivityFeed(); }
    )
    .subscribe();
}

async function loadActivityFeed() {
  const { data, error } = await supabase
    .from('activity_log')
    .select(`*, user:profiles(full_name, avatar_initials)`)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error || !data) return;

  const feed = document.getElementById('activityFeed');
  feed.innerHTML = data.map(activity => `
    <div class="tl-item">
      <div class="tl-time">${timeAgo(activity.created_at)}</div>
      <div class="tl-text">
        <b>${escapeHtml(activity.user?.full_name || 'System')}</b>
        ${escapeHtml(activity.description)}
      </div>
    </div>
  `).join('');
}

function timeAgo(timestamp) {
  const seconds = Math.floor((new Date() - new Date(timestamp)) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + ' min ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + ' hr ago';
  return Math.floor(seconds / 86400) + ' days ago';
}

// ============ WORKLOAD METER ============
function calculateWorkload(logs) {
  const active = logs.filter(l => l.status !== 'resolved');
  if (active.length === 0) return 100;

  let score = 100;
  const critical = active.filter(l => l.priority === 'Critical').length;
  score -= critical * 8;
  const high = active.filter(l => l.priority === 'High').length;
  score -= high * 4;
  const now = new Date();
  const overdue = active.filter(l => l.due_date && new Date(l.due_date) < now).length;
  score -= overdue * 10;
  const pending = active.filter(l => l.status === 'pending').length;
  score -= pending * 2;

  return Math.max(0, Math.min(100, score));
}

function getWorkloadStatus(score) {
  if (score >= 80) return { label: 'Excellent', color: '#2DB84C' };
  if (score >= 60) return { label: 'Good', color: '#7CC142' };
  if (score >= 40) return { label: 'Moderate', color: '#FBBF24' };
  if (score >= 20) return { label: 'Low', color: '#FF9A3C' };
  return { label: 'Critical', color: '#FF5C5C' };
}

function updateWorkloadMeter(logs) {
  const score = calculateWorkload(logs);
  const status = getWorkloadStatus(score);
  const targetAngle = -90 + (score / 100) * 180;
  animateNeedle(targetAngle);

  document.getElementById('gaugeValue').innerHTML =
    `${score}<span style="font-size:24px;color:var(--text-dim)">%</span>`;

  const pill = document.getElementById('gaugePill');
  pill.textContent = status.label;
  pill.style.background = status.color + '25';
  pill.style.color = status.color;

  const active = logs.filter(l => l.status !== 'resolved');
  const pending = active.filter(l => l.status === 'pending').length;
  const now = new Date();
  const overdue = active.filter(l => l.due_date && new Date(l.due_date) < now).length;
  const onTrack = active.length > 0
    ? Math.round((active.length - overdue) / active.length * 100)
    : 100;

  document.querySelectorAll('.wm-item .val')[0].textContent = pending;
  document.querySelectorAll('.wm-item .val')[1].textContent = overdue;
  document.querySelectorAll('.wm-item .val')[2].textContent = onTrack + '%';

  if (score < 35) {
    document.getElementById('alertRibbon').style.display = 'flex';
  } else {
    document.getElementById('alertRibbon').style.display = 'none';
  }
}

let currentNeedleAngle = -90;

function animateNeedle(targetAngle) {
  const needleGroup = document.getElementById('needleGroup');
  if (!needleGroup) return;

  const startAngle = currentNeedleAngle;
  const distance = targetAngle - startAngle;
  const duration = 800;
  const startTime = performance.now();

  function tick(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const angle = startAngle + (distance * eased);
    needleGroup.setAttribute('transform', `rotate(${angle} 100 110)`);
    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      currentNeedleAngle = targetAngle;
    }
  }
  requestAnimationFrame(tick);
}

// ============ UPDATE KPIs ============
function updateKPIs(logs) {
  const active = logs.filter(l => l.status !== 'resolved');

  document.querySelector('.kpi-grid .kpi:nth-child(1) .kpi-value').textContent = logs.length;

  const inProgress = active.filter(l => l.status === 'in_progress').length;
  document.querySelector('.kpi-grid .kpi:nth-child(2) .kpi-value').textContent = inProgress;

  const critical = active.filter(l => l.priority === 'Critical').length;
  document.querySelector('.kpi-grid .kpi:nth-child(3) .kpi-value').textContent = critical;

  const resolved = logs.filter(l => l.status === 'resolved');
  const onTime = resolved.filter(l => {
    if (!l.due_date || !l.resolved_at) return true;
    return new Date(l.resolved_at) <= new Date(l.due_date);
  });
  const sla = resolved.length > 0
    ? Math.round((onTime.length / resolved.length) * 100)
    : 100;
  document.querySelector('.kpi-grid .kpi:nth-child(4) .kpi-value').textContent = sla + '%';

  const clientCount = new Set(logs.map(l => l.client_id)).size;
  document.querySelector('.kpi:nth-child(1) .kpi-meta b').textContent = `${clientCount} clients`;
}