import { Resend } from 'resend';
import { requireAuth, setCors, ensureLegalFooter, buildHtmlEmail } from './_lib.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = requireAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { to, subject, body } = req.body || {};
  if (!to || !subject || !body) {
    return res.status(400).json({ error: 'Champs manquants (to, subject, body).' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) {
    return res.status(500).json({
      error: 'Resend non configuré. Définis RESEND_API_KEY et RESEND_FROM dans Vercel.',
    });
  }

  // Garde-fou RGPD : si le client a édité le mail et supprimé le footer légal,
  // on le ré-ajoute avant envoi. Le destinataire DOIT avoir un opt-out lisible.
  const finalBody = ensureLegalFooter(body);

  // Version HTML (signature + footer HTML inclus). On envoie les deux ;
  // les clients mail choisissent leur version selon les préférences user.
  const htmlBody = buildHtmlEmail(body);

  const resend = new Resend(apiKey);

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: [to],
      subject,
      text: finalBody,
      html: htmlBody,
    });
    if (error) {
      console.error('Resend error:', error);
      return res.status(500).json({ error: error.message || 'Erreur Resend', detail: error });
    }
    return res.json({ ok: true, messageId: data?.id || null });
  } catch (err) {
    console.error('Send error:', err);
    return res.status(500).json({ error: err.message });
  }
}
