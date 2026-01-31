// SAFE TEST ONLY / Multi-Branch Enhancement
// Quick verification script to exercise test endpoints. Run with: node backend/testVerification.js
// Requires a valid ADMIN or MANAGER JWT token exported as STEAKZ_TOKEN env variable.

const fetch = require('node-fetch');
require('dotenv').config();

const BASE = 'http://localhost:3001/api/test';
const token = process.env.STEAKZ_TOKEN;
if (!token) {
  console.error('Missing STEAKZ_TOKEN env var with a valid JWT. Aborting.');
  process.exit(1);
}

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

(async () => {
  try {
    console.log('--- TEST VERIFICATION START ---');
    // Fetch first branch id via production branches endpoint
    const branchesRes = await fetch('http://localhost:3001/api/branches', { headers: { Authorization: `Bearer ${token}` } });
    const branches = await branchesRes.json();
    const branchId = branches?.[0]?.id;
    if (!branchId) throw new Error('No branch id available for testing');
    console.log('Using branchId:', branchId);

    // Prices: upsert a fake override
    const priceUpsert = await call('POST', `/branches/${branchId}/prices`, { menuItemId: 1, overridePrice: 19.99, currency: 'USD', notes: 'Verification override' });
    console.log('Price upsert status', priceUpsert.status, priceUpsert.data.id || priceUpsert.data.message);

    const pricesList = await call('GET', `/branches/${branchId}/prices`);
    console.log('Prices list count:', Array.isArray(pricesList.data) ? pricesList.data.length : 'ERR');

    // Inventory: create synthetic item
    const invCreate = await call('POST', `/branches/${branchId}/inventory`, { name: 'Verification Item', quantity: 5, unit: 'pcs', status: 'OK' });
    console.log('Inventory create status', invCreate.status, invCreate.data.id || invCreate.data.message);

    const invList = await call('GET', `/branches/${branchId}/inventory`);
    console.log('Inventory list count:', Array.isArray(invList.data) ? invList.data.length : 'ERR');

    // Staff: create synthetic staff
    const staffCreate = await call('POST', `/branches/${branchId}/staff`, { name: 'Verification Staff', role: 'CHEF' });
    console.log('Staff create status', staffCreate.status, staffCreate.data.id || staffCreate.data.message);

    const staffList = await call('GET', `/branches/${branchId}/staff`);
    console.log('Staff list count:', Array.isArray(staffList.data) ? staffList.data.length : 'ERR');

    console.log('--- TEST VERIFICATION COMPLETE ---');
  } catch (e) {
    console.error('Verification failed:', e.message);
    process.exit(1);
  }
})();
