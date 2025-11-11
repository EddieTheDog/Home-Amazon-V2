// Simple single-file Express app for Home-Amazon demo.
// Uses JSON file persistence (data/db.json). Designed for Render free tier.

const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const multer = require('multer');
const qrcode = require('qrcode');
const bwipjs = require('bwip-js');
const { nanoid } = require('nanoid');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Simple JSON file DB helpers
function readDB() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return { reservations: [] };
  }
}
function writeDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}
let db = readDB();

// ensure structure
if (!db.reservations) db.reservations = [];

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());

// Sessions - require SESSION_SECRET env var on Render
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 24 * 3600 * 1000 }
}));

// Multer for proof photo uploads
const upload = multer({ dest: UPLOADS_DIR });

// Role credentials from env (simple demo)
const FRONT_DESK_PASS = process.env.FRONT_DESK_PASS || 'frontdesk';
const STORE_PASS = process.env.STORE_PASS || 'store';
const DRIVER_PASS = process.env.DRIVER_PASS || 'driver';

// Utilities
function findReservation(idOrTracking) {
  return db.reservations.find(r => r.id === idOrTracking || r.trackingNumber === idOrTracking);
}
function saveReservation(reservation) {
  const idx = db.reservations.findIndex(r => r.id === reservation.id);
  if (idx === -1) {
    db.reservations.push(reservation);
  } else {
    db.reservations[idx] = reservation;
  }
  writeDB(db);
}

function nowISO() {
  return new Date().toISOString();
}

// Auth middleware
function requireRole(role) {
  return (req, res, next) => {
    if (req.session && req.session.role === role) return next();
    return res.redirect(`/login?role=${role}`);
  };
}

// Routes: Public UI
app.get('/', (req, res) => {
  res.render('index', { message: null });
});

app.post('/api/reservations', (req, res) => {
  const { customerName, customerContact, itemDescription, weightEstimate, desiredWindow } = req.body;
  if (!itemDescription || itemDescription.trim() === '') {
    return res.status(400).json({ error: 'itemDescription required' });
  }
  const id = 'R' + nanoid(6).toUpperCase();
  const reservation = {
    id,
    trackingNumber: null,
    customerName: customerName || null,
    customerContact: customerContact || null,
    itemDescription,
    weightEstimate: weightEstimate || null,
    desiredWindow: desiredWindow || null,
    status: 'reserved',
    storageLocation: null,
    frontDeskTags: [],
    driverId: null,
    proof: null,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    events: [{ eventType: 'reserved', actor: 'customer', timestamp: nowISO(), note: 'Reservation created' }]
  };
  saveReservation(reservation);
  const qrUrl = `${getBaseUrl(req)}/track/${id}`;
  return res.status(201).json({ id, qrUrl });
});

app.get('/track/:id', async (req, res) => {
  const id = req.params.id;
  const reservation = findReservation(id);
  if (!reservation) {
    return res.status(404).render('track', { reservation: null, message: 'Reservation not found' });
  }
  // generate QR (data URL) for sharing
  const qrUrl = `${getBaseUrl(req)}/track/${reservation.id}`;
  const qrDataUrl = await qrcode.toDataURL(qrUrl).catch(() => null);
  res.render('track', { reservation, qrDataUrl, message: null });
});

app.get('/api/reservations/:id', (req, res) => {
  const reservation = findReservation(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'Not found' });
  return res.json(reservation);
});

// Front desk UI & APIs
app.get('/desk', requireRole('frontdesk'), (req, res) => {
  res.render('desk', { user: req.session.user, message: null });
});

app.post('/api/reservations/:id/assign-tracking', requireRole('frontdesk'), (req, res) => {
  const id = req.params.id;
  const reservation = findReservation(id);
  if (!reservation) return res.status(404).json({ error: 'Not found' });
  const { trackingNumber, storageLocation, frontDeskTags } = req.body;
  reservation.trackingNumber = trackingNumber || `T-${nanoid(6).toUpperCase()}`;
  reservation.storageLocation = storageLocation || reservation.storageLocation;
  reservation.frontDeskTags = Array.isArray(frontDeskTags) ? frontDeskTags : (frontDeskTags ? [frontDeskTags] : reservation.frontDeskTags);
  reservation.status = reservation.status === 'reserved' ? 'checked_in' : reservation.status;
  reservation.updatedAt = nowISO();
  reservation.events.push({ eventType: 'checked_in', actor: 'frontdesk', timestamp: nowISO(), note: `Assigned tracking ${reservation.trackingNumber}` });
  saveReservation(reservation);
  return res.json(reservation);
});

app.get('/api/reservations/:id/label', requireRole('frontdesk'), (req, res) => {
  const id = req.params.id;
  const reservation = findReservation(id);
  if (!reservation || !reservation.trackingNumber) return res.status(404).send('Reservation or tracking number not found');
  // Create barcode PNG buffer
  bwipjs.toBuffer({
    bcid: 'code128',
    text: reservation.trackingNumber,
    scale: 3,
    height: 10,
    includetext: true,
    textxalign: 'center'
  }, function (err, png) {
    if (err) {
      return res.status(500).send('Barcode generation error');
    } else {
      const barcodeBase64 = png.toString('base64');
      res.render('print_label', { reservation, barcodeBase64 });
    }
  });
});

// Edit package
app.put('/api/reservations/:id', requireRole('frontdesk'), (req, res) => {
  const id = req.params.id;
  const reservation = findReservation(id);
  if (!reservation) return res.status(404).json({ error: 'Not found' });
  const allowed = ['itemDescription', 'customerName', 'customerContact', 'weightEstimate', 'storageLocation', 'frontDeskTags'];
  allowed.forEach(field => {
    if (req.body[field] !== undefined) reservation[field] = req.body[field];
  });
  reservation.updatedAt = nowISO();
  reservation.events.push({ eventType: 'edited', actor: 'frontdesk', timestamp: nowISO(), note: 'Edited details' });
  saveReservation(reservation);
  return res.json(reservation);
});

// Store endpoints
app.get('/store', requireRole('store'), (req, res) => {
  const list = db.reservations.filter(r => ['checked_in', 'stored', 'ready'].includes(r.status));
  res.render('store', { user: req.session.user, list });
});

app.post('/api/reservations/:id/move-to-loading', requireRole('store'), (req, res) => {
  const reservation = findReservation(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'Not found' });
  reservation.status = 'ready';
  reservation.updatedAt = nowISO();
  reservation.events.push({ eventType: 'moved_to_loading', actor: 'store', timestamp: nowISO(), note: 'Moved to loading bay' });
  saveReservation(reservation);
  return res.json(reservation);
});

app.post('/api/reservations/:id/mark-ready', requireRole('store'), (req, res) => {
  const reservation = findReservation(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'Not found' });
  reservation.status = 'ready';
  reservation.updatedAt = nowISO();
  reservation.events.push({ eventType: 'marked_ready', actor: 'store', timestamp: nowISO(), note: 'Marked ready for delivery' });
  saveReservation(reservation);
  return res.json(reservation);
});

// Driver endpoints & UI
app.get('/driver', requireRole('driver'), (req, res) => {
  res.render('driver', { user: req.session.user, message: null });
});

app.post('/api/reservations/:id/claim', requireRole('driver'), (req, res) => {
  const reservation = findReservation(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'Not found' });
  if (reservation.status === 'out_for_delivery' && reservation.driverId) {
    return res.status(409).json({ error: 'Already claimed' });
  }
  reservation.driverId = req.session.user || 'driver';
  reservation.status = 'out_for_delivery';
  reservation.updatedAt = nowISO();
  reservation.events.push({ eventType: 'claimed', actor: 'driver', timestamp: nowISO(), note: `Claimed by ${reservation.driverId}` });
  saveReservation(reservation);
  return res.json(reservation);
});

app.post('/api/reservations/:id/deliver', requireRole('driver'), upload.single('proofPhoto'), (req, res) => {
  const reservation = findReservation(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'Not found' });
  const { proofType, proofValue } = req.body;
  if (req.file) {
    // move is already in UPLOADS_DIR with filename in req.file.path
    const filename = path.basename(req.file.path);
    reservation.proof = { type: 'photo', value: `/uploads/${filename}` }; // note: uploads route not exposed, but preview in README
  } else if (proofType === 'text' && proofValue) {
    reservation.proof = { type: 'text', value: proofValue };
  }
  reservation.status = 'delivered';
  reservation.updatedAt = nowISO();
  reservation.events.push({ eventType: 'delivered', actor: 'driver', timestamp: nowISO(), note: 'Delivered' });
  saveReservation(reservation);
  return res.json(reservation);
});

// List with optional status filter
app.get('/api/reservations', (req, res) => {
  const status = req.query.status;
  let list = db.reservations;
  if (status) {
    list = list.filter(r => r.status === status);
  }
  return res.json(list);
});

// Simple login / logout
app.get('/login', (req, res) => {
  const role = req.query.role || '';
  res.render('login', { role, message: null });
});

app.post('/login', (req, res) => {
  const { role, password } = req.body;
  let ok = false;
  if (role === 'frontdesk' && password === FRONT_DESK_PASS) ok = true;
  if (role === 'store' && password === STORE_PASS) ok = true;
  if (role === 'driver' && password === DRIVER_PASS) ok = true;
  if (!ok) {
    return res.render('login', { role, message: 'Invalid credentials' });
  }
  req.session.role = role;
  req.session.user = role;
  // redirect to role home
  if (role === 'frontdesk') return res.redirect('/desk');
  if (role === 'store') return res.redirect('/store');
  if (role === 'driver') return res.redirect('/driver');
  return res.redirect('/');
});

app.post('/logout', (req, res) => {
  req.session.destroy(err => res.redirect('/'));
});

// Serve uploads (note: persisted only while instance runs)
app.use('/uploads', express.static(UPLOADS_DIR));

// Utility to get base url
function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

// Health
app.get('/health', (req, res) => res.json({ ok: true }));

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
