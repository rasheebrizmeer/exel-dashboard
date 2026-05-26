// js/error-logs.js

// ============ FETCH ALL ERROR LOGS ============
async function fetchErrorLogs(filters = {}) {
  let query = supabase
    .from('error_logs')
    .select(`
      *,
      client:clients(id, name, industry),
      submitter:profiles!error_logs_submitted_by_fkey(id, full_name),
      staff:profiles!error_logs_assigned_staff_fkey(id, full_name, avatar_initials)
    `)
    .order('created_at', { ascending: false });

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.priority) query = query.eq('priority', filters.priority);
  if (filters.clientId) query = query.eq('client_id', filters.clientId);
  if (filters.assignedTo) query = query.eq('assigned_staff', filters.assignedTo);
  if (filters.search) query = query.ilike('title', `%${filters.search}%`);

  const { data, error } = await query;
  if (error) {
    console.error('Fetch error:', error);
    toast('alert', 'Error', 'Could not load error logs.');
    return [];
  }
  return data;
}

// ============ FETCH SINGLE ERROR LOG ============
async function fetchErrorLog(id) {
  const { data, error } = await supabase
    .from('error_logs')
    .select(`
      *,
      client:clients(*),
      submitter:profiles!error_logs_submitted_by_fkey(*),
      staff:profiles!error_logs_assigned_staff_fkey(*),
      comments(*, user:profiles(full_name, avatar_initials))
    `)
    .eq('id', id)
    .single();

  if (error) {
    console.error('Fetch error:', error);
    return null;
  }
  return data;
}

// ============ SUBMIT NEW ERROR LOG ============
async function createErrorLog(errorLogData) {
  let clientId = errorLogData.client_id;

  if (!clientId && errorLogData.clientName) {
    const { data: existing } = await supabase
      .from('clients')
      .select('id')
      .eq('name', errorLogData.clientName)
      .maybeSingle();

    if (existing) {
      clientId = existing.id;
    } else {
      if (window.currentProfile.role === 'qa_head') {
        const { data: newClient, error: clientErr } = await supabase
          .from('clients')
          .insert({
            name: errorLogData.clientName,
            industry: 'Not specified'
          })
          .select()
          .single();

        if (clientErr) {
          toast('alert', 'Error', 'Could not create client.');
          return null;
        }
        clientId = newClient.id;
      } else {
        toast('alert', 'Error', 'Client not found. Contact QA Head.');
        return null;
      }
    }
  }

  const { data, error } = await supabase
    .from('error_logs')
    .insert({
      title: errorLogData.title,
      description: errorLogData.description,
      client_id: clientId,
      submitted_by: window.currentUser.id,
      assigned_staff: errorLogData.assignedStaff || null,
      category: errorLogData.category,
      priority: errorLogData.priority,
      status: 'pending',
      progress: 0,
      due_date: errorLogData.dueDate
    })
    .select()
    .single();

  if (error) {
    console.error('Insert error:', error);
    toast('alert', 'Error', 'Could not submit error log: ' + error.message);
    return null;
  }

  toast('success', 'Error log submitted', `"${data.title}" added to the queue.`);
  await refreshDashboard();
  return data;
}

// ============ UPDATE STATUS ============
async function updateErrorLogStatus(id, newStatus) {
  const update = { status: newStatus };
  if (newStatus === 'resolved') {
    update.resolved_at = new Date().toISOString();
    update.progress = 100;
  }

  const { data, error } = await supabase
    .from('error_logs')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    toast('alert', 'Error', 'Could not update status.');
    return null;
  }

  toast('success', 'Status updated', `Marked as ${newStatus}.`);
  await refreshDashboard();
  return data;
}

// ============ UPDATE PROGRESS ============
async function updateProgress(id, percentage) {
  percentage = Math.max(0, Math.min(100, percentage));
  const update = { progress: percentage };
  if (percentage === 100) {
    update.status = 'resolved';
    update.resolved_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from('error_logs')
    .update(update)
    .eq('id', id);

  if (error) {
    toast('alert', 'Error', 'Could not update progress.');
    return false;
  }

  await refreshDashboard();
  return true;
}

// ============ ASSIGN TO STAFF ============
async function assignStaff(errorLogId, staffId) {
  const { error } = await supabase
    .from('error_logs')
    .update({ assigned_staff: staffId })
    .eq('id', errorLogId);

  if (error) {
    toast('alert', 'Error', 'Could not assign staff.');
    return false;
  }

  toast('success', 'Assigned', 'Staff member assigned.');
  return true;
}

// ============ ADD COMMENT ============
async function addComment(errorLogId, body) {
  const { data, error } = await supabase
    .from('comments')
    .insert({
      error_log_id: errorLogId,
      user_id: window.currentUser.id,
      body: body
    })
    .select()
    .single();

  if (error) {
    toast('alert', 'Error', 'Could not add comment.');
    return null;
  }
  return data;
}

// ============ DELETE ERROR LOG (QA Head only) ============
async function deleteErrorLog(id) {
  const { error } = await supabase
    .from('error_logs')
    .delete()
    .eq('id', id);

  if (error) {
    toast('alert', 'Error', 'Could not delete: ' + error.message);
    return false;
  }

  toast('success', 'Deleted', 'Error log removed.');
  await refreshDashboard();
  return true;
}

// ============ SUBMIT FORM HANDLER ============
async function submitErrorLog() {
  const data = {
    title: document.getElementById('ntTitle').value,
    clientName: document.getElementById('ntClient').value,
    category: document.getElementById('ntCat').value,
    priority: document.getElementById('ntPri').value,
    dueDate: document.getElementById('ntDue').value,
    assignedStaff: document.getElementById('ntAss').value === 'Auto-assign'
      ? null
      : document.getElementById('ntAss').value,
    description: document.getElementById('ntDesc').value
  };

  if (!data.title) {
    toast('alert', 'Missing field', 'Please enter an error log title.');
    return;
  }
  if (!data.clientName) {
    toast('alert', 'Missing field', 'Please enter a client name.');
    return;
  }

  const result = await createErrorLog(data);
  if (result) {
    closeModal();
    document.getElementById('ntTitle').value = '';
    document.getElementById('ntClient').value = '';
    document.getElementById('ntDesc').value = '';
  }
}

document.querySelector('.modal-f .btn-prim').onclick = submitErrorLog;

// ============ RENDER OVERVIEW TABLE ============
function renderOverviewTable(logs) {
  const tbody = document.getElementById('overviewTasks');
  tbody.innerHTML = logs.map(log => `
    <tr>
      <td>
        <div class="task-title">${escapeHtml(log.title)}</div>
        <div class="task-desc">${escapeHtml(log.description || '')}</div>
      </td>
      <td>${escapeHtml(log.client?.name || 'Unknown')}</td>
      <td>${priorityBadge(log.priority)}</td>
      <td>${statusBadge(log.status)}</td>
      <td>
        <div class="prog-row">
          <div class="prog">
            <div class="prog-fill" style="width:${log.progress}%"></div>
          </div>
          <span class="pct">${log.progress}%</span>
        </div>
      </td>
      <td class="mono">${formatDate(log.due_date)}</td>
    </tr>
  `).join('');
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============ RENDER ALL ERROR LOGS ============
function renderAllErrorLogs(logs) {
  const tbody = document.getElementById('allTasksTbody');
  tbody.innerHTML = logs.map(log => `
    <tr data-log-id="${log.id}" style="cursor:pointer">
      <td>
        <div class="task-title">${escapeHtml(log.title)}</div>
        <div class="task-desc">${escapeHtml(log.description || '')}</div>
      </td>
      <td>${escapeHtml(log.client?.name || 'Unknown')}</td>
      <td><span class="badge badge-cat">${log.category}</span></td>
      <td>${log.staff
        ? `<span class="av-inline">${log.staff.avatar_initials}</span> ${log.staff.full_name}`
        : '<span style="color:var(--text-mute)">Unassigned</span>'
      }</td>
      <td>${priorityBadge(log.priority)}</td>
      <td>${statusBadge(log.status)}</td>
      <td>
        <div class="prog-row">
          <div class="prog">
            <div class="prog-fill" style="width:${log.progress}%"></div>
          </div>
          <span class="pct">${log.progress}%</span>
        </div>
      </td>
      <td class="mono">${formatDate(log.due_date)}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('tr[data-log-id]').forEach(row => {
    row.addEventListener('click', () => {
      openLogDetail(row.getAttribute('data-log-id'));
    });
  });
}

// ============ REFRESH DASHBOARD ============
async function refreshDashboard() {
  const logs = await fetchErrorLogs();
  const activeCount = logs.filter(l => l.status !== 'resolved').length;
  document.getElementById('taskBadge').textContent = activeCount;
  renderOverviewTable(logs.slice(0, 6));
  renderAllErrorLogs(logs);
  updateKPIs(logs);
  updateWorkloadMeter(logs);
}

document.addEventListener('DOMContentLoaded', refreshDashboard);

// ============ LOG DETAIL MODAL ============
let currentLogId = null;

async function openLogDetail(logId) {
  currentLogId = logId;
  const log = await fetchErrorLog(logId);
  if (!log) {
    toast('alert', 'Error', 'Could not load error log.');
    return;
  }

  document.getElementById('ldTitle').textContent = log.title;
  document.getElementById('ldClient').textContent =
    `${log.client?.name || 'Unknown'} · Submitted ${timeAgo(log.created_at)}`;
  document.getElementById('ldCat').textContent = log.category;
  document.getElementById('ldPri').innerHTML = priorityBadge(log.priority);
  document.getElementById('ldStatus').innerHTML = statusBadge(log.status);
  document.getElementById('ldDue').textContent = formatDate(log.due_date);
  document.getElementById('ldDesc').textContent =
    log.description || 'No description provided.';
  document.getElementById('ldProgress').value = log.progress;
  document.getElementById('ldProgressLabel').textContent = log.progress + '%';

  renderLogComments(log.comments || []);
  renderActionButtons(log);

  if (log.status === 'resolved' && log.resolution_notes) {
    const panel = document.getElementById('ldResolvedPanel');
    panel.style.display = 'block';
    let resolverName = 'QA Team';
    if (log.resolved_by) {
      const { data: resolver } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', log.resolved_by)
        .single();
      if (resolver) resolverName = resolver.full_name;
    }
    document.getElementById('ldResolvedAt').textContent =
      `Resolved ${timeAgo(log.resolved_at)} by ${resolverName}`;
    document.getElementById('ldResolvedNotes').textContent = log.resolution_notes;
  } else {
    document.getElementById('ldResolvedPanel').style.display = 'none';
  }

  document.getElementById('logDetailModal').classList.add('show');
}

function closeLogDetail() {
  document.getElementById('logDetailModal').classList.remove('show');
  currentLogId = null;
}

function renderLogComments(comments) {
  const wrap = document.getElementById('ldComments');
  if (!comments || comments.length === 0) {
    wrap.innerHTML = `<div style="text-align:center;color:var(--text-mute);padding:12px;font-size:12px">No comments yet.</div>`;
    return;
  }
  wrap.innerHTML = comments.map(c => `
    <div style="padding:8px 10px;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <div style="font-size:12px;font-weight:600">${escapeHtml(c.user?.full_name || 'Unknown')}</div>
        <div style="font-size:11px;color:var(--text-mute)" class="mono">${timeAgo(c.created_at)}</div>
      </div>
      <div style="font-size:13px;color:var(--text-dim)">${escapeHtml(c.body)}</div>
    </div>
  `).join('');
}

function renderActionButtons(log) {
  const wrap = document.getElementById('ldActions');
  const isQA = window.currentProfile.role === 'qa_head';

  if (!isQA) {
    wrap.innerHTML = `<button class="btn" onclick="closeLogDetail()">Close</button>`;
    document.getElementById('ldProgress').disabled = true;
    return;
  }

  let buttons = '<button class="btn" onclick="closeLogDetail()">Close</button>';
  switch (log.status) {
    case 'pending':
      buttons += `
        <button class="btn" onclick="changeStatus('${log.id}', 'awaiting_review')">→ Send for Review</button>
        <button class="btn btn-prim" onclick="changeStatus('${log.id}', 'in_progress')">■ Start Work</button>
      `;
      break;
    case 'in_progress':
      buttons += `
        <button class="btn" onclick="saveProgress('${log.id}')">Save Progress</button>
        <button class="btn" onclick="changeStatus('${log.id}', 'awaiting_review')">→ Submit for Review</button>
        <button class="btn btn-prim" onclick="markResolved('${log.id}')">✓ Mark Resolved</button>
      `;
      break;
    case 'awaiting_review':
      buttons += `
        <button class="btn" onclick="changeStatus('${log.id}', 'in_progress')">■ Send back to work</button>
        <button class="btn btn-prim" onclick="markResolved('${log.id}')">✓ Approve & Resolve</button>
      `;
      break;
    case 'resolved':
      buttons += `<button class="btn" onclick="changeStatus('${log.id}', 'in_progress')">■ Reopen</button>`;
      if (log.resolution_notes) {
        const wrap2 = document.getElementById('ldResolutionWrap');
        wrap2.style.display = 'block';
        document.getElementById('ldResolution').value = log.resolution_notes;
        document.getElementById('ldResolution').disabled = true;
      }
      break;
  }
  wrap.innerHTML = buttons;
}

async function changeStatus(logId, newStatus) {
  const messages = {
    'in_progress': 'Mark this error log as In Progress?',
    'awaiting_review': 'Submit this error log for review?',
    'pending': 'Move this back to Pending?'
  };

  if (messages[newStatus] && !confirm(messages[newStatus])) return;

  const { data, error } = await supabase
    .from('error_logs')
    .update({
      status: newStatus,
      ...(newStatus === 'in_progress' && { progress: 10 })
    })
    .eq('id', logId)
    .select(`*, client:clients(*), staff:profiles!error_logs_assigned_staff_fkey(*), comments(*, user:profiles(full_name, avatar_initials))`)
    .single();

  if (error) {
    toast('alert', 'Error', 'Could not change status: ' + error.message);
    return;
  }

  await supabase.from('comments').insert({
    error_log_id: logId,
    user_id: window.currentUser.id,
    body: `Status changed to "${formatStatus(newStatus)}".`
  });

  toast('success', 'Status updated', `Marked as ${formatStatus(newStatus)}.`);
  await openLogDetail(logId);
  await refreshDashboard();
}

function formatStatus(status) {
  const map = {
    'pending': 'Pending',
    'in_progress': 'In Progress',
    'awaiting_review': 'Awaiting Review',
    'resolved': 'Resolved'
  };
  return map[status] || status;
}

async function saveProgress(logId) {
  const progress = parseInt(document.getElementById('ldProgress').value);
  const { error } = await supabase
    .from('error_logs')
    .update({ progress: progress })
    .eq('id', logId);

  if (error) {
    toast('alert', 'Error', 'Could not save progress.');
    return;
  }
  toast('success', 'Progress saved', `Set to ${progress}%.`);
  await refreshDashboard();
}

document.addEventListener('DOMContentLoaded', () => {
  const slider = document.getElementById('ldProgress');
  if (slider) {
    slider.addEventListener('input', (e) => {
      document.getElementById('ldProgressLabel').textContent = e.target.value + '%';
    });
  }
});

async function markResolved(logId) {
  const wrap = document.getElementById('ldResolutionWrap');
  const notesField = document.getElementById('ldResolution');

  if (wrap.style.display === 'none') {
    wrap.style.display = 'block';
    notesField.disabled = false;
    notesField.focus();
    toast('info', 'Resolution notes required', 'Please describe how the issue was resolved.');
    return;
  }

  const notes = notesField.value.trim();
  if (notes.length < 10) {
    toast('alert', 'Notes too short', 'Please provide at least 10 characters of resolution detail.');
    notesField.focus();
    return;
  }

  if (!confirm('Mark this error log as Resolved? The client will be notified.')) return;

  const { data, error } = await supabase
    .from('error_logs')
    .update({
      status: 'resolved',
      progress: 100,
      resolution_notes: notes,
      resolved_at: new Date().toISOString(),
      resolved_by: window.currentUser.id
    })
    .eq('id', logId)
    .select()
    .single();

  if (error) {
    toast('alert', 'Error', 'Could not resolve: ' + error.message);
    return;
  }

  await supabase.from('comments').insert({
    error_log_id: logId,
    user_id: window.currentUser.id,
    body: `✓ Resolved by ${window.currentProfile.full_name}. ${notes}`
  });

  toast('success', 'Error log resolved', 'Client has been notified via dashboard.');
  closeLogDetail();
  await refreshDashboard();
}

async function postComment() {
  if (!currentLogId) return;
  const input = document.getElementById('ldNewComment');
  const body = input.value.trim();

  if (body.length < 2) {
    toast('alert', 'Empty comment', 'Type something before posting.');
    return;
  }

  const { data, error } = await supabase
    .from('comments')
    .insert({
      error_log_id: currentLogId,
      user_id: window.currentUser.id,
      body: body
    })
    .select('*, user:profiles(full_name, avatar_initials)')
    .single();

  if (error) {
    toast('alert', 'Error', 'Could not post comment.');
    return;
  }

  input.value = '';
  toast('success', 'Comment added', 'Visible to everyone on this log.');
  await openLogDetail(currentLogId);
}

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('ldNewComment');
  if (input) {
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') postComment();
    });
  }
});

// ============ REAL-TIME SUBSCRIPTIONS ============
let errorLogChannel = null;

function startRealtimeUpdates() {
  if (errorLogChannel) supabase.removeChannel(errorLogChannel);

  errorLogChannel = supabase
    .channel('error-logs-changes')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'error_logs' },
      async (payload) => {
        toast('info', 'New error log', `"${payload.new.title}" was just submitted.`);
        await refreshDashboard();
        playNotificationSound();
      }
    )
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'error_logs' },
      async (payload) => {
        const oldStatus = payload.old.status;
        const newStatus = payload.new.status;

        if (window.currentProfile.role === 'client') {
          if (oldStatus !== 'resolved' && newStatus === 'resolved') {
            toast('success', 'Error log resolved',
              `"${payload.new.title}" has been resolved by the QA team. Click to view details.`);
            playNotificationSound();
          } else if (oldStatus === 'pending' && newStatus === 'in_progress') {
            toast('info', 'Work started', `QA team is now working on "${payload.new.title}".`);
          }
        }

        if (window.currentProfile.role === 'qa_head') {
          if (oldStatus !== newStatus) await refreshDashboard();
        }

        if (currentLogId === payload.new.id) await openLogDetail(currentLogId);
        await refreshDashboard();
      }
    )
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'error_logs' },
      async () => { await refreshDashboard(); }
    )
    .subscribe((status) => { console.log('Realtime status:', status); });
}

function stopRealtimeUpdates() {
  if (errorLogChannel) {
    supabase.removeChannel(errorLogChannel);
    errorLogChannel = null;
  }
}

function playNotificationSound() {
  try {
    const audio = new Audio('data:audio/wav;base64,...');
    audio.volume = 0.3;
    audio.play();
  } catch(e) { /* ignore */ }
}

document.addEventListener('DOMContentLoaded', () => { startRealtimeUpdates(); });
window.addEventListener('beforeunload', stopRealtimeUpdates);
