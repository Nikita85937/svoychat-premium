const express = require('express');
const admin = require('firebase-admin');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const serviceAccount = {
  type: 'service_account',
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

app.post('/webhook', async (req, res) => {
  try {
    const event = req.body;
    if (!event || event.event !== 'payment.succeeded') {
      return res.status(200).json({ ok: true });
    }
    const payment = event.object;
    const uid = payment.metadata && payment.metadata.uid;
    if (!uid) {
      console.log('No UID in payment metadata');
      return res.status(200).json({ ok: true });
    }
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 30);
    await db.collection('premium').doc(uid).set({
      uid: uid,
      expiry: admin.firestore.Timestamp.fromDate(expiry),
      paymentId: payment.id,
      amount: payment.amount.value,
      activatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`Premium activated for uid: ${uid} until ${expiry}`);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'svoychat-premium' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
