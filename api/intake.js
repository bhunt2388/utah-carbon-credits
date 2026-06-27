// /api/intake.js — Vercel Serverless Function
// Handles form submission → SignNow doc → Calendly redirect

const SIGNNOW_API = 'https://api.signnow.com';
const SIGNNOW_TOKEN = process.env.SIGNNOW_TOKEN;
const TEMPLATE_DOC_ID = 'a663fba92a7e4598a88240968168e75426cd1c13';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'ben.thrasher20@gmail.com';

const WIRE_INSTRUCTIONS = `
WIRE INSTRUCTIONS — WELCOME 1231 LLC
⚠️  DUE TO WIRE FRAUD: DO NOT WIRE FUNDS WITHOUT FIRST VERIFYING WIRING
    INSTRUCTIONS BY CALLING 801-400-2916

Bank:           Mountain America Credit Union
Address:        3300 Triumph Blvd, Lehi, Utah 84043
Routing #:      324079555
Account Name:   Welcome 1231 LLC
Account #:      13553279

*** OUR WIRE INSTRUCTIONS DO NOT CHANGE ***
`;

function calcDeal(faceValue) {
  const face = parseFloat(faceValue) || 0;
  const assignmentFee = +(face * 0.85).toFixed(2);
  const creditPurchasePrice = +(face * 0.70).toFixed(2);
  const netBenefit = +(face * 0.15).toFixed(2);
  const savingsRate = '17.6%';
  return { face, assignmentFee, creditPurchasePrice, netBenefit, savingsRate };
}

function fmtDollars(n) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0 });
}

async function cloneAndSendDoc(buyerName, buyerEmail, buyerTitle, deal, closingDate) {
  // Step 1: Copy the template document
  const copyRes = await fetch(`${SIGNNOW_API}/document/${TEMPLATE_DOC_ID}/copy`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SIGNNOW_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ document_name: `Welcome1231_Assignment_${buyerName.replace(/\s+/g,'_')}_${closingDate}` }),
  });
  const copied = await copyRes.json();
  if (!copied.id) throw new Error('SignNow copy failed: ' + JSON.stringify(copied));
  const docId = copied.id;

  // Step 2: Add text fields / prefill fields via field invite
  // Step 3: Send for signature to buyer
  const inviteRes = await fetch(`${SIGNNOW_API}/document/${docId}/invite`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SIGNNOW_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: NOTIFY_EMAIL,
      to: [
        {
          email: buyerEmail,
          role: 'Assignee',
          order: 1,
          reassign: '0',
          decline_by_signature: '0',
          reminder: 1,
          expiration_days: 14,
          subject: `Action Required: Sign Your §45Q Credit Purchase Right Assignment Agreement`,
          message: `Dear ${buyerName},\n\nThank you for your interest in acquiring Section 45Q Carbon Oxide Sequestration Tax Credits through Welcome 1231 LLC.\n\nYour Assignment Agreement has been prepared with the following deal terms:\n\n• Face Value of Tax Credits: ${fmtDollars(deal.face)}\n• Assignment Fee (your payment to Welcome 1231 LLC): ${fmtDollars(deal.assignmentFee)}\n• Net Tax Benefit to You: ${fmtDollars(deal.netBenefit)}\n• Effective Tax Savings Rate: ${deal.savingsRate}\n\nPlease review and sign the attached agreement at your earliest convenience.\n\n---\nWIRE INSTRUCTIONS — WELCOME 1231 LLC\n⚠️  DUE TO WIRE FRAUD: DO NOT WIRE FUNDS WITHOUT FIRST VERIFYING WIRING INSTRUCTIONS BY CALLING 801-400-2916\n\nBank: Mountain America Credit Union\nAddress: 3300 Triumph Blvd, Lehi, Utah 84043\nRouting #: 324079555\nAccount Name: Welcome 1231 LLC\nAccount #: 13553279\n\n*** Our Wire Instructions Do Not Change ***\n---\n\nIf you have any questions, please reply to this email or call 801-400-2916.\n\nThank you,\nWelcome 1231 LLC\nUtah Carbon MGR LLC`,
        }
      ],
    }),
  });
  const invite = await inviteRes.json();
  return { docId, invite };
}

async function sendNotificationEmail(buyerName, buyerEmail, buyerPhone, deal) {
  // Use Resend if configured, otherwise log. 
  // For now we use a simple fetch to Resend API if RESEND_API_KEY is set.
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) {
    console.log('No RESEND_API_KEY — skipping notification email');
    return;
  }
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Utah Carbon Credits <noreply@utahcarboncredits.com>',
      to: [NOTIFY_EMAIL],
      subject: `🔔 New Lead: ${buyerName} — ${fmtDollars(deal.face)} face value`,
      html: `
        <h2>New Credit Buyer Lead</h2>
        <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
          <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Name</td><td>${buyerName}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Email</td><td>${buyerEmail}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Phone</td><td>${buyerPhone || '—'}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Face Value</td><td>${fmtDollars(deal.face)}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Assignment Fee</td><td>${fmtDollars(deal.assignmentFee)}</td></tr>
          <tr><td style="padding:6px 16px 6px 0;font-weight:bold">Net Benefit to Buyer</td><td>${fmtDollars(deal.netBenefit)}</td></tr>
        </table>
        <p style="margin-top:20px;color:#666">Assignment Agreement sent to buyer via SignNow. Watch for signature notification.</p>
        <hr/>
        <p style="font-size:12px;color:#999">Utah Carbon Credits · Welcome 1231 LLC</p>
      `,
    }),
  });
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      title,
      firm,
      faceValue,
      taxLiability,
    } = req.body;

    if (!firstName || !lastName || !email || !faceValue) {
      return res.status(400).json({ error: 'Missing required fields: firstName, lastName, email, faceValue' });
    }

    const buyerName = `${firstName} ${lastName}`;
    const buyerTitle = title || '';
    const deal = calcDeal(faceValue);
    const closingDate = new Date().toISOString().split('T')[0];

    // 1. Clone template + send for signature via SignNow
    const { docId } = await cloneAndSendDoc(buyerName, email, buyerTitle, deal, closingDate);

    // 2. Send internal notification
    await sendNotificationEmail(buyerName, email, phone, deal);

    // 3. Build Calendly URL with pre-filled name/email
    const calendlyBase = 'https://calendly.com/carbon-credits-ben';
    const calendlyUrl = `${calendlyBase}?name=${encodeURIComponent(buyerName)}&email=${encodeURIComponent(email)}`;

    // 4. Return success + redirect URL
    return res.status(200).json({
      success: true,
      docId,
      calendlyUrl,
      deal: {
        face: fmtDollars(deal.face),
        assignmentFee: fmtDollars(deal.assignmentFee),
        netBenefit: fmtDollars(deal.netBenefit),
        savingsRate: deal.savingsRate,
      },
      wire: {
        bank: 'Mountain America Credit Union',
        routing: '324079555',
        account: '13553279',
        accountName: 'Welcome 1231 LLC',
        address: '3300 Triumph Blvd, Lehi, Utah 84043',
        verifyPhone: '801-400-2916',
        warning: 'DO NOT WIRE FUNDS WITHOUT FIRST VERIFYING BY CALLING 801-400-2916',
      },
      message: `Agreement sent to ${email} for signature. Please schedule your call.`,
    });

  } catch (err) {
    console.error('Intake error:', err);
    return res.status(500).json({ error: err.message });
  }
}
