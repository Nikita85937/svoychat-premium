const express = require('express');
const admin = require('firebase-admin');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS — разрешаем запросы с любого домена (наш чат на Netlify)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// Firebase init
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

// ЮKassa credentials
const SHOP_ID = process.env.YUKASSA_SHOP_ID || '1164507';
const SECRET_KEY = process.env.YUKASSA_SECRET_KEY;

// Создать платёж ЮKassa
app.post('/create-payment', async (req, res) => {
  try {
    const { uid, email, returnUrl } = req.body;
    if (!uid) return res.status(400).json({ error: 'uid required' });

    const idempotenceKey = `${uid}_${Date.now()}`;

    const payment = await axios.post(
      'https://api.yookassa.ru/v3/payments',
      {
        amount: { value: '99.00', currency: 'RUB' },
        confirmation: {
          type: 'redirect',
          return_url: returnUrl || 'https://yourchats.netlify.app'
        },
        capture: true,
        description: 'Свой чат Премиум — 1 месяц',
        metadata: { uid, email: email || '' },
        receipt: email ? {
          customer: { email },
          items: [{
            description: 'Свой чат Премиум — 1 месяц',
            quantity: '1',
            amount: { value: '99.00', currency: 'RUB' },
            vat_code: 1
          }]
        } : undefined
      },
      {
        auth: { username: SHOP_ID, password: SECRET_KEY },
        headers: {
          'Idempotence-Key': idempotenceKey,
          'Content-Type': 'application/json'
        }
      }
    );

    const confirmationUrl = payment.data.confirmation.confirmation_url;
    res.json({ confirmationUrl, paymentId: payment.data.id });

  } catch (err) {
    console.error('Create payment error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.description || err.message });
  }
});

// Webhook от ЮKassa — автоматическая активация премиума
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
      uid,
      expiry: admin.firestore.Timestamp.fromDate(expiry),
      paymentId: payment.id,
      amount: payment.amount.value,
      activatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`✅ Premium activated for uid: ${uid} until ${expiry}`);
    res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Healthcheck
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'svoychat-premium' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
