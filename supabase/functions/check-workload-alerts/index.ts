// supabase/functions/check-workload-alerts/index.ts
// Use a newer std version to ensure the http server module is available
import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: settings } = await supabaseAdmin
      .from('alert_settings')
      .select('*');

    const config = {};
    settings.forEach(s => config[s.setting_key] = s.setting_value);

    const { data: logs } = await supabaseAdmin
      .from('error_logs')
      .select('id, title, priority, status, due_date, client_id')
      .neq('status', 'resolved');

    const critical = logs.filter(l => l.priority === 'Critical').length;
    const overdue = logs.filter(l =>
      l.due_date && new Date(l.due_date) < new Date()
    ).length;

    const workloadScore = calculateWorkload(logs);

    let alertReason = null;
    if (critical >= parseInt(config.critical_threshold)) {
      alertReason = `${critical} critical error logs exceed threshold`;
    } else if (overdue >= parseInt(config.overdue_threshold)) {
      alertReason = `${overdue} overdue error logs detected`;
    } else if (workloadScore < parseInt(config.workload_meter_trigger)) {
      alertReason = `Workload meter dropped to ${workloadScore}%`;
    }

    if (!alertReason) {
      return new Response(JSON.stringify({
        status: 'ok',
        message: 'No alerts triggered',
        stats: { critical, overdue, workload: workloadScore }
      }));
    }

    const cooldownMinutes = parseInt(config.alert_cooldown_minutes);
    const cutoff = new Date(Date.now() - cooldownMinutes * 60 * 1000);
    const { data: recent } = await supabaseAdmin
      .from('email_alerts')
      .select('id')
      .eq('status', 'sent')
      .gte('sent_at', cutoff.toISOString())
      .limit(1);

    if (recent && recent.length > 0) {
      return new Response(JSON.stringify({
        status: 'skipped',
        message: 'Alert within cooldown period'
      }));
    }

    const emailSent = await sendAlertEmail(
      config.alert_recipient,
      alertReason,
      { critical, overdue, workloadScore, logs }
    );

    await supabaseAdmin.from('email_alerts').insert({
      alert_type: 'workload_critical',
      recipient_email: config.alert_recipient,
      subject: `■ ${alertReason}`,
      body: alertReason,
      status: emailSent ? 'sent' : 'failed',
      sent_at: emailSent ? new Date().toISOString() : null
    });

    return new Response(JSON.stringify({
      status: 'alert_sent',
      reason: alertReason,
      stats: { critical, overdue, workload: workloadScore }
    }));

  } catch (err) {
    return new Response(JSON.stringify({
      status: 'error',
      message: err.message
    }), { status: 500 });
  }
});

function calculateWorkload(logs) {
  if (logs.length === 0) return 100;
  let score = 100;
  const critical = logs.filter(l => l.priority === 'Critical').length;
  score -= critical * 8;
  const high = logs.filter(l => l.priority === 'High').length;
  score -= high * 4;
  const overdue = logs.filter(l =>
    l.due_date && new Date(l.due_date) < new Date()
  ).length;
  score -= overdue * 10;
  const pending = logs.filter(l => l.status === 'pending').length;
  score -= pending * 2;
  return Math.max(0, Math.min(100, score));
}

async function sendAlertEmail(to, reason, stats) {
  const apiKey = Deno.env.get('RESEND_API_KEY');

  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;">
      <div style="background:linear-gradient(135deg,#1B4F9C,#2DB84C);padding:20px;color:white;">
        <h1 style="margin:0;font-size:22px;">■ Workload Alert</h1>
      </div>
      <div style="padding:24px;background:#f9fafb;">
        <p style="font-size:16px;"><strong>${reason}</strong></p>
        <table style="width:100%;margin:20px 0;border-collapse:collapse;">
          <tr>
            <td><strong>Critical error logs:</strong></td>
            <td style="color:#dc2626;font-weight:bold;">${stats.critical}</td>
          </tr>
          <tr>
            <td><strong>Overdue:</strong></td>
            <td style="color:#ea580c;font-weight:bold;">${stats.overdue}</td>
          </tr>
          <tr>
            <td><strong>Workload meter:</strong></td>
            <td style="color:#1B4F9C;font-weight:bold;">${stats.workloadScore}%</td>
          </tr>
        </table>
        <a href="https://your-app.vercel.app/dashboard.html"
          style="display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#1B4F9C,#2DB84C);color:white;text-decoration:none;border-radius:8px;font-weight:600;">
          Open Dashboard →
        </a>
      </div>
    </div>
  `;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'EXEL Alerts <alerts@yourdomain.com>',
      to: [to],
      subject: `■ ${reason}`,
      html: html
    })
  });

  return res.ok;
}
