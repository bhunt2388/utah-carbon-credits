// /api/cpa.js — CPA Verification Form Handler
const SIGNNOW_API = 'https://api.signnow.com';
const SIGNNOW_TOKEN = process.env.SIGNNOW_TOKEN;
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'ben.thrasher20@gmail.com';

async function sendNotification(data) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Utah Carbon Credits <noreply@utahcarboncredits.com>',
      to: [NOTIFY_EMAIL],
      subject: `✅ CPA Verification Received — ${data.clientName}`,
      html: `
        <h2>CPA Accredited Investor Verification</h2>
        <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;line-height:2">
          <tr><td style="font-weight:bold;padding-right:20px">Client Name</td><td>${data.clientName}</td></tr>
          <tr><td style="font-weight:bold;padding-right:20px">Client Email</td><td>${data.clientEmail}</td></tr>
          <tr><td style="font-weight:bold;padding-right:20px">CPA Name</td><td>${data.cpaFirst} ${data.cpaLast}</td></tr>
          <tr><td style="font-weight:bold;padding-right:20px">CPA Firm</td><td>${data.cpaFirm}</td></tr>
          <tr><td style="font-weight:bold;padding-right:20px">CPA Email</td><td>${data.cpaEmail}</td></tr>
          <tr><td style="font-weight:bold;padding-right:20px">CPA Phone</td><td>${data.cpaPhone || '—'}</td></tr>
          <tr><td style="font-weight:bold;padding-right:20px">License #</td><td>${data.licenseNumber || '—'}</td></tr>
          <tr><td style="font-weight:bold;padding-right:20px">License State</td><td>${data.licenseState || '—'}</td></tr>
          <tr><td style="font-weight:bold;padding-right:20px">Accredited Status</td><td style="color:green">✓ Confirmed</td></tr>
          <tr><td style="font-weight:bold;padding-right:20px">§38(c) Capacity</td><td style="color:green">✓ Confirmed — ${data.taxCapacity}</td></tr>
          <tr><td style="font-weight:bold;padding-right:20px">Submitted</td><td>${new Date().toLocaleString()}</td></tr>
        </table>
        <p style="margin-top:20px;padding:16px;background:#f0fdf4;border-radius:8px;font-size:13px">
          This CPA verification letter satisfies the accredited investor verification requirement under Rule 506(c)(2)(ii) of Regulation D.
        </p>
      `,
    }),
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      clientName, clientEmail,
      cpaFirst, cpaLast, cpaEmail, cpaPhone,
      cpaFirm, licenseNumber, licenseState,
      taxCapacity,
    } = req.body;

    if (!clientName || !clientEmail || !cpaFirst || !cpaLast || !cpaEmail || !cpaFirm) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    await sendNotification(req.body);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('CPA handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}
