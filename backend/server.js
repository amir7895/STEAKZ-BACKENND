const express = require('express');
const { PrismaClient } = require('@prisma/client');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { requireRoles, enforceBranchAccess, requireChefOrdersOnly, blockChefFromNonOrders } = require('./middleware/rbac');
// Load environment variables
require('dotenv').config();

const app = express();
const prisma = new PrismaClient();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// SAFE TEST ONLY / Multi-Branch Enhancement: register additive test routes
const registerTestRoutes = require('./testRoutes'); // SAFE TEST ONLY
// Will mount after basic middleware so authenticateToken is available

// Middleware to verify JWT token
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(401).json({ message: 'Invalid token' });
  }
};

// Multi-Branch Enhancement: attach user's persisted active branch id to request
const attachActiveBranch = async (req, res, next) => {
  try {
    if (!req.user) return next();
    const u = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { activeBranchId: true }
    });
    req.activeBranchId = u?.activeBranchId || null;
  } catch (e) {
    req.activeBranchId = null;
  } finally {
    next();
  }
};

// Helper to resolve effective branchId: ADMIN can switch (use query/header/activeBranchId), non-admins locked to user.branchId
const resolveBranchId = (req, candidate) => {
  const role = (req.user?.role || '').toUpperCase();
  
  // Non-admin: always locked to their assigned branch
  if (role !== 'ADMIN') {
    return req.user?.branchId != null ? parseInt(req.user.branchId) : null;
  }
  
  // ADMIN: can switch via candidate (query/param), activeBranchId, or user.branchId
  const chosen = candidate ?? req.activeBranchId ?? req.user?.branchId ?? null;
  return chosen != null ? parseInt(chosen) : null;
};

// Auth Routes
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, branchId } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        role: 'CUSTOMER',
        branchId
      }
    });

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET);
    res.json({ user, token });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(400).json({ message: 'Error creating user' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET);
    res.json({ user, token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(400).json({ message: 'Error during login' });
  }
});

// Orders Routes
app.post(
  '/api/orders/create',
  authenticateToken,
  attachActiveBranch,
  attachActiveBranch,
  requireRoles(['ADMIN', 'MANAGER', 'CHEF', 'STAFF', 'CUSTOMER']),
  enforceBranchAccess((req) => resolveBranchId(req, req.body.branchId)),
  async (req, res) => {
    try {
      const { items, total } = req.body;
      if (!branchId) return res.status(400).json({ message: 'branchId is required' });
      const branchId = resolveBranchId(req, req.body.branchId);
      if (!branchId) return res.status(400).json({ message: 'branchId is required' });

      const result = await prisma.$transaction(async (prismaTx) => {
        // Create order scoped to branch
        const order = await prismaTx.order.create({
          data: {
            userId: req.user.id,
            branchId,
            total,
            items: {
              create: items.map(item => ({
                menuItemId: item.menuItemId,
                quantity: item.quantity,
                price: item.price
              }))
            }
          },
          include: { items: true }
        });

        // Update inventory for the same branch
        for (const item of items) {
          const inventoryItem = await prismaTx.inventoryItem.findFirst({
            where: { menuItemId: item.menuItemId, branchId }
          });

          if (!inventoryItem || inventoryItem.quantity < item.quantity) {
            throw new Error(`Insufficient inventory for item ${item.menuItemId}`);
          }

          await prismaTx.inventoryItem.update({
            where: { id: inventoryItem.id },
            data: { quantity: inventoryItem.quantity - item.quantity }
          });
        }

        return order;
      });

      res.json(result);
    } catch (error) {
      console.error('Order creation error:', error);
      res.status(400).json({ message: error.message });
    }
  }
);

// Multi-Branch Enhancement: optional branchId not supported by Express 5 path-to-regexp here; using explicit path variants
app.get(
  '/api/orders',
  authenticateToken,
  attachActiveBranch,
  requireRoles(['ADMIN', 'MANAGER', 'CHEF', 'STAFF', 'CUSTOMER']),
  enforceBranchAccess((req) => resolveBranchId(req, req.query.branchId)),
  async (req, res) => {
    try {
      const role = (req.user.role || '').toUpperCase();
      const branchId = resolveBranchId(req, req.query.branchId);

      const where = {
        branchId,
        ...(role === 'CUSTOMER' ? { userId: req.user.id } : {})
      };

      const orders = await prisma.order.findMany({
        where: branchId ? { ...where, branchId } : where,
        include: {
          items: { include: { menuItem: true } },
          user: true
        }
      });
      res.json(orders);
    } catch (error) {
      console.error('Get orders error:', error);
      res.status(400).json({ message: 'Error fetching orders' });
    }
  }
);

app.get(
  '/api/orders/:branchId',
  authenticateToken,
  attachActiveBranch,
  requireRoles(['ADMIN', 'MANAGER', 'CHEF', 'STAFF', 'CUSTOMER']),
  enforceBranchAccess((req) => resolveBranchId(req, req.params.branchId)),
  async (req, res) => {
    try {
      const role = (req.user.role || '').toUpperCase();
      const branchId = resolveBranchId(req, req.params.branchId);
      if (!branchId) return res.status(400).json({ message: 'branchId is required' });

      const where = {
        branchId,
        ...(role === 'CUSTOMER' ? { userId: req.user.id } : {})
      };

      const orders = await prisma.order.findMany({
        where: branchId ? { ...where, branchId } : where,
        include: {
          items: { include: { menuItem: true } },
          user: true
        }
      });
      res.json(orders);
    } catch (error) {
      console.error('Get orders error:', error);
      res.status(400).json({ message: 'Error fetching orders' });
    }
  }
);

app.patch(
  '/api/orders/status/:id',
  authenticateToken,
  attachActiveBranch,
  requireRoles(['ADMIN', 'MANAGER', 'CHEF']),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const role = (req.user.role || '').toUpperCase();

      const order = await prisma.order.findUnique({
        where: { id: parseInt(id) },
        select: { id: true, branchId: true, userId: true }
      });

      if (!order) return res.status(404).json({ message: 'Order not found' });

      const userBranchId = resolveBranchId(req);
      if (!userBranchId || Number(order.branchId) !== Number(userBranchId)) {
        return res.status(403).json({ message: 'Branch access denied for order update' });
      }

      const updated = await prisma.order.update({
        where: { id: order.id },
        data: { status }
      });
      res.json(updated);
    } catch (error) {
      console.error('Update order status error:', error);
      res.status(400).json({ message: 'Error updating order status' });
    }
  }
);

// Inventory Routes
// CHEF: Access denied to inventory (orders only)
app.get(
  '/api/inventory/:branchId',
  authenticateToken,
  attachActiveBranch,
  blockChefFromNonOrders(),
  requireRoles(['ADMIN', 'MANAGER', 'STAFF']),
  enforceBranchAccess((req) => resolveBranchId(req, req.params.branchId)),
  async (req, res) => {
    try {
      const branchId = resolveBranchId(req, req.params.branchId);
      const inventory = await prisma.inventoryItem.findMany({
        where: { branchId },
        include: { menuItem: true }
      });
      res.json(inventory);
    } catch (error) {
      console.error('Get inventory error:', error);
      res.status(400).json({ message: 'Error fetching inventory' });
    }
  }
);

// Create new inventory item
app.post(
  '/api/inventory/create',
  authenticateToken,
  attachActiveBranch,
  requireRoles(['ADMIN', 'MANAGER']),
  async (req, res) => {
    try {
      const { menuItemId, quantity = 0, minQuantity = 10 } = req.body;

      if (!menuItemId) {
        return res.status(400).json({ message: 'Menu item ID is required' });
      }

      const branchId = resolveBranchId(req);
      if (!branchId) {
        return res.status(400).json({ message: 'Branch ID required' });
      }

      // Verify menu item exists
      const menuItem = await prisma.menuItem.findUnique({
        where: { id: parseInt(menuItemId) }
      });

      if (!menuItem) {
        return res.status(404).json({ message: 'Menu item not found' });
      }

      // Check if inventory already exists for this menu item at this branch
      const existing = await prisma.inventoryItem.findUnique({
        where: {
          menuItemId_branchId: {
            menuItemId: parseInt(menuItemId),
            branchId: branchId
          }
        }
      });

      if (existing) {
        return res.status(400).json({ message: 'Inventory already exists for this menu item at this branch' });
      }

      // Create new inventory item
      const inventory = await prisma.inventoryItem.create({
        data: {
          menuItemId: parseInt(menuItemId),
          quantity: Math.max(0, quantity),
          minQuantity: Math.max(0, minQuantity),
          branchId: branchId
        },
        include: { menuItem: true }
      });

      res.status(201).json(inventory);
    } catch (error) {
      console.error('Create inventory error:', error);
      res.status(400).json({ message: 'Error creating inventory item' });
    }
  }
);

// Create inventory with new menu item (manual entry)
app.post(
  '/api/inventory/create-with-item',
  authenticateToken,
  attachActiveBranch,
  requireRoles(['ADMIN', 'MANAGER']),
  async (req, res) => {
    try {
      const { name, category, description, price, quantity = 0, minQuantity = 10 } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({ message: 'Item name is required' });
      }

      const branchId = resolveBranchId(req);
      if (!branchId) {
        return res.status(400).json({ message: 'Branch ID required' });
      }

      // Create menu item first
      const menuItem = await prisma.menuItem.create({
        data: {
          name: name.trim(),
          category: category || 'Other',
          description: description && description.trim() ? description.trim() : `${name.trim()} inventory item`,
          price: price ? parseFloat(price) : 0,
          branchId: branchId
        }
      });

      // Then create inventory for this menu item
      const inventory = await prisma.inventoryItem.create({
        data: {
          menuItemId: menuItem.id,
          quantity: Math.max(0, quantity),
          minQuantity: Math.max(0, minQuantity),
          branchId: branchId
        },
        include: { menuItem: true }
      });

      res.status(201).json(inventory);
    } catch (error) {
      console.error('Create inventory with item error:', error);
      res.status(400).json({ message: error.message || 'Error creating inventory item' });
    }
  }
);

app.patch(
  '/api/inventory/:id',
  authenticateToken,
  attachActiveBranch,
  requireRoles(['ADMIN', 'MANAGER']),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { quantity } = req.body;

      const existing = await prisma.inventoryItem.findUnique({
        where: { id: parseInt(id) },
        select: { id: true, branchId: true }
      });

      if (!existing) return res.status(404).json({ message: 'Inventory item not found' });

      if ((req.user.role || '').toUpperCase() !== 'ADMIN') {
        const userBranchId = resolveBranchId(req);
        if (!userBranchId || Number(existing.branchId) !== Number(userBranchId)) {
          return res.status(403).json({ message: 'Branch access denied for inventory update' });
        }
      }

      const inventory = await prisma.inventoryItem.update({
        where: { id: existing.id },
        data: { quantity }
      });
      res.json(inventory);
    } catch (error) {
      console.error('Update inventory error:', error);
      res.status(400).json({ message: 'Error updating inventory' });
    }
  }
);

// Reservation Routes
// CHEF: Access denied to reservations (orders only)
app.post(
  '/api/reservations/create',
  authenticateToken,
  attachActiveBranch,
  blockChefFromNonOrders(),
  requireRoles(['ADMIN', 'MANAGER', 'STAFF', 'CUSTOMER']),
  enforceBranchAccess((req) => resolveBranchId(req, req.body.branchId)),
  async (req, res) => {
    try {
      const { date, time, guests, notes } = req.body;
      const branchId = resolveBranchId(req, req.body.branchId);
      if (!branchId) return res.status(400).json({ message: 'branchId is required' });

      const reservation = await prisma.reservation.create({
        data: {
          userId: req.user.id,
          branchId,
          date: new Date(date),
          time,
          guests,
          notes
        }
      });
      res.json(reservation);
    } catch (error) {
      console.error('Create reservation error:', error);
      res.status(400).json({ message: 'Error creating reservation' });
    }
  }
);

app.get(
  '/api/reservations',
  authenticateToken,
  attachActiveBranch,
  blockChefFromNonOrders(),
  requireRoles(['ADMIN', 'MANAGER', 'STAFF', 'CUSTOMER']),
  enforceBranchAccess((req) => resolveBranchId(req, req.query.branchId ?? req.activeBranchId)),
  async (req, res) => {
    try {
      const role = (req.user.role || '').toUpperCase();
      const branchId = resolveBranchId(req, req.query.branchId ?? req.activeBranchId);
      const where = {
        ...(branchId ? { branchId } : {}),
        ...(role === 'CUSTOMER' ? { userId: req.user.id } : {})
      };
      const reservations = await prisma.reservation.findMany({
        where: branchId ? { ...where, branchId } : where,
        include: { user: true }
      });
      res.json(reservations);
    } catch (error) {
      console.error('Get reservations error:', error);
      res.status(400).json({ message: 'Error fetching reservations' });
    }
  }
);

// CHEF: Access denied to reservations (orders only)
app.get(
  '/api/reservations/:branchId',
  authenticateToken,
  attachActiveBranch,
  blockChefFromNonOrders(),
  requireRoles(['ADMIN', 'MANAGER', 'STAFF', 'CUSTOMER']),
  enforceBranchAccess((req) => resolveBranchId(req, req.params.branchId)),
  async (req, res) => {
    try {
      const role = (req.user.role || '').toUpperCase();
      const branchId = resolveBranchId(req, req.params.branchId);
      const where = {
        ...(branchId ? { branchId } : {}),
        ...(role === 'CUSTOMER' ? { userId: req.user.id } : {})
      };
      const reservations = await prisma.reservation.findMany({
        where: branchId ? { ...where, branchId } : where,
        include: { user: true }
      });
      res.json(reservations);
    } catch (error) {
      console.error('Get reservations error:', error);
      res.status(400).json({ message: 'Error fetching reservations' });
    }
  }
);

// Multi-Branch Enhancement: user active branch GET
app.get('/api/users/:id/active-branch', authenticateToken, async (req, res) => {
  try {
    if (!['MANAGER', 'ADMIN'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    const userId = parseInt(req.params.id);
    if (userId !== req.user.id) {
      return res.status(403).json({ message: 'Cannot access other user active branch' });
    }
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { activeBranchId: true, activeBranch: { select: { id: true, name: true, city: true, country: true } } }
    });
    console.info('[Multi-Branch Enhancement] Fetched active branch for user', userId, u?.activeBranchId);
    res.json({ activeBranchId: u?.activeBranchId || null, activeBranch: u?.activeBranch || null });
  } catch (error) {
    console.error('Active branch fetch error:', error);
    res.status(400).json({ message: 'Error fetching active branch' });
  }
});

// Multi-Branch Enhancement: user active branch PATCH
// CRITICAL: Only ADMIN can switch active branch per global rules
app.patch('/api/users/:id/active-branch', authenticateToken, requireRoles(['ADMIN']), async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (userId !== req.user.id) {
      return res.status(403).json({ message: 'Cannot modify other user active branch' });
    }
    const { branchId } = req.body;
    if (!branchId) {
      return res.status(400).json({ message: 'branchId required' });
    }
    const branch = await prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) return res.status(404).json({ message: 'Branch not found' });
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { activeBranchId: branchId }
    });
    console.info('[Multi-Branch Enhancement] Updated active branch for user', userId, '->', branchId);
    res.json({ activeBranchId: updated.activeBranchId });
  } catch (error) {
    console.error('Active branch update error:', error);
    res.status(400).json({ message: 'Error updating active branch' });
  }
});

app.patch(
  '/api/reservations/status/:id',
  authenticateToken,
  blockChefFromNonOrders(),
  requireRoles(['ADMIN', 'MANAGER', 'STAFF']),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const role = (req.user.role || '').toUpperCase();

      const reservation = await prisma.reservation.findUnique({
        where: { id: parseInt(id) },
        select: { id: true, branchId: true }
      });
      if (!reservation) return res.status(404).json({ message: 'Reservation not found' });

      if (role !== 'ADMIN') {
        const userBranchId = resolveBranchId(req);
        if (!userBranchId || Number(reservation.branchId) !== Number(userBranchId)) {
          return res.status(403).json({ message: 'Branch access denied for reservation update' });
        }
      }

      const updated = await prisma.reservation.update({
        where: { id: reservation.id },
        data: { status }
      });
      res.json(updated);
    } catch (error) {
      console.error('Update reservation status error:', error);
      res.status(400).json({ message: 'Error updating reservation status' });
    }
  }
);

// --------------------- Feedback Routes ---------------------
// Create feedback (any authenticated user)
// CHEF: Access denied to feedback (orders only)
app.post(
  '/api/feedback/create',
  authenticateToken,
  attachActiveBranch,
  blockChefFromNonOrders(),
  requireRoles(['ADMIN', 'MANAGER', 'STAFF', 'CUSTOMER']),
  enforceBranchAccess((req) => resolveBranchId(req, req.body.branchId)),
  async (req, res) => {
    try {
      const { rating, comment } = req.body;
      const branchId = resolveBranchId(req, req.body.branchId);
      if (!branchId || !rating || !comment) {
        return res.status(400).json({ message: 'branchId, rating, and comment are required' });
      }
      if (rating < 1 || rating > 5) {
        return res.status(400).json({ message: 'rating must be between 1 and 5' });
      }
      const fb = await prisma.feedback.create({
        data: {
          userId: req.user.id,
          branchId,
          rating,
          comment
        },
        include: { user: true }
      });
      res.json(fb);
    } catch (error) {
      console.error('Create feedback error:', error);
      res.status(400).json({ message: 'Error creating feedback' });
    }
  }
);

// Get feedback for a branch; customers only see their own, staff+ see all
// CHEF: Access denied to feedback (orders only)
app.get(
  '/api/feedback/:branchId',
  authenticateToken,
  attachActiveBranch,
  blockChefFromNonOrders(),
  requireRoles(['ADMIN', 'MANAGER', 'STAFF', 'CUSTOMER']),
  enforceBranchAccess((req) => resolveBranchId(req, req.params.branchId)),
  async (req, res) => {
    try {
      const branchId = resolveBranchId(req, req.params.branchId);
      if (!branchId) return res.status(400).json({ message: 'branchId is required' });
      const where = {
        branchId,
        ...(req.user.role === 'CUSTOMER' ? { userId: req.user.id } : {})
      };
      const list = await prisma.feedback.findMany({
        where,
        include: { user: true },
        orderBy: { createdAt: 'desc' }
      });
      res.json(list);
    } catch (error) {
      console.error('Get feedback error:', error);
      res.status(400).json({ message: 'Error fetching feedback' });
    }
  }
);

// Reply to feedback (staff or above)
app.patch(
  '/api/feedback/reply/:id',
  authenticateToken,
  requireRoles(['ADMIN', 'MANAGER', 'STAFF']),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { reply } = req.body;
      if (!reply || !reply.trim()) {
        return res.status(400).json({ message: 'Reply text is required' });
      }

      const existing = await prisma.feedback.findUnique({
        where: { id: parseInt(id) },
        select: { id: true, branchId: true }
      });
      if (!existing) return res.status(404).json({ message: 'Feedback not found' });

      if ((req.user.role || '').toUpperCase() !== 'ADMIN') {
        const userBranchId = resolveBranchId(req);
        if (!userBranchId || Number(existing.branchId) !== Number(userBranchId)) {
          return res.status(403).json({ message: 'Branch access denied for feedback reply' });
        }
      }

      const updated = await prisma.feedback.update({
        where: { id: existing.id },
        data: { reply: reply.trim() },
        include: { user: true }
      });
      res.json(updated);
    } catch (error) {
      console.error('Reply feedback error:', error);
      res.status(400).json({ message: 'Error replying to feedback' });
    }
  }
);

// Approve feedback (staff or above)
app.patch(
  '/api/feedback/approve/:id',
  authenticateToken,
  requireRoles(['ADMIN', 'MANAGER', 'STAFF']),
  async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await prisma.feedback.findUnique({
        where: { id: parseInt(id) },
        select: { id: true, branchId: true }
      });
      if (!existing) return res.status(404).json({ message: 'Feedback not found' });

      if ((req.user.role || '').toUpperCase() !== 'ADMIN') {
        const userBranchId = resolveBranchId(req);
        if (!userBranchId || Number(existing.branchId) !== Number(userBranchId)) {
          return res.status(403).json({ message: 'Branch access denied for feedback approval' });
        }
      }

      const updated = await prisma.feedback.update({
        where: { id: existing.id },
        data: { approved: true },
        include: { user: true }
      });
      res.json(updated);
    } catch (error) {
      console.error('Approve feedback error:', error);
      res.status(400).json({ message: 'Error approving feedback' });
    }
  }
);

// Delete feedback (staff or above)
app.delete(
  '/api/feedback/:id',
  authenticateToken,
  requireRoles(['ADMIN', 'MANAGER', 'STAFF']),
  async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await prisma.feedback.findUnique({
        where: { id: parseInt(id) },
        select: { id: true, branchId: true }
      });
      if (!existing) return res.status(404).json({ message: 'Feedback not found' });

      if ((req.user.role || '').toUpperCase() !== 'ADMIN') {
        const userBranchId = resolveBranchId(req);
        if (!userBranchId || Number(existing.branchId) !== Number(userBranchId)) {
          return res.status(403).json({ message: 'Branch access denied for feedback delete' });
        }
      }

      await prisma.feedback.delete({ where: { id: existing.id } });
      res.json({ message: 'Feedback deleted' });
    } catch (error) {
      console.error('Delete feedback error:', error);
      res.status(400).json({ message: 'Error deleting feedback' });
    }
  }
);

// --------------------- Branch Multi-Branch Enhancement ---------------------
// Multi-Branch Enhancement: Branch analytics endpoint (MANAGER/ADMIN only)
app.get(
  '/api/branches/:id/analytics',
  authenticateToken,
  attachActiveBranch,
  requireRoles(['ADMIN', 'MANAGER']),
  enforceBranchAccess((req) => resolveBranchId(req, req.params.id)),
  async (req, res) => {
    try {
      const branchId = resolveBranchId(req, req.params.id);
      if (Number.isNaN(branchId)) {
        return res.status(400).json({ message: 'Invalid branch id' });
      }

      const [orderAgg, reservationCount, feedbackAgg] = await Promise.all([
        prisma.order.aggregate({ where: { branchId }, _sum: { total: true }, _count: true }),
        prisma.reservation.count({ where: { branchId } }),
        prisma.feedback.aggregate({ where: { branchId, approved: true }, _avg: { rating: true }, _count: true })
      ]);

      const inventoryItems = await prisma.inventoryItem.findMany({
        where: { branchId },
        select: { id: true, quantity: true, minQuantity: true }
      });
      const lowStockCount = inventoryItems.filter(i => i.quantity < (i.minQuantity ?? 10)).length;

      res.json({
        sales: { count: orderAgg._count, total: orderAgg._sum.total || 0 },
        reservations: { count: reservationCount },
        feedback: { count: feedbackAgg._count, averageRating: feedbackAgg._avg.rating || 0 },
        inventory: { lowStockCount }
      });
    } catch (error) {
      console.error('Branch analytics error:', error);
      res.status(400).json({ message: 'Error fetching branch analytics' });
    }
  }
);

// Multi-Branch Enhancement: List branches (branch-scoped for all users including ADMIN)
app.get(
  '/api/branches',
  authenticateToken,
  requireRoles(['ADMIN', 'MANAGER', 'CHEF', 'STAFF']),
  async (req, res) => {
    try {
      const role = (req.user.role || '').toUpperCase();
      const userBranchId = resolveBranchId(req);

      // CRITICAL: Branch selector data
      // - ADMIN: returns ALL branches
      // - Non-admin: returns only user's branch
      const where = role === 'ADMIN' ? {} : { id: userBranchId };

      const branches = await prisma.branch.findMany({
        where,
        select: {
          id: true,
          name: true,
          location: true,
          country: true,
          city: true,
          address: true,
          postalCode: true,
          phone: true,
          email: true,
          timezone: true,
          latitude: true,
          longitude: true,
          openingTime: true,
          closingTime: true
        },
        orderBy: { name: 'asc' }
      });
      res.json(branches);
    } catch (error) {
      console.error('List branches error:', error);
      res.status(400).json({ message: 'Error fetching branches' });
    }
  }
);

// Multi-Branch Enhancement: Seed sample branches (ADMIN only, idempotent)
app.post('/api/branches/seed-sample', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Unauthorized' });
    }
    const samples = [
      { name: 'Steakz London', city: 'London', country: 'UK', timezone: 'Europe/London', address: '10 Downing St', postalCode: 'SW1A 2AA', phone: '+44 20 7946 0000', email: 'london@steakz.example', latitude: 51.5034, longitude: -0.1276, openingTime: '09:00', closingTime: '22:00' },
      { name: 'Steakz Paris', city: 'Paris', country: 'France', timezone: 'Europe/Paris', address: '5 Avenue Anatole France', postalCode: '75007', phone: '+33 1 2345 6789', email: 'paris@steakz.example', latitude: 48.8584, longitude: 2.2945, openingTime: '09:00', closingTime: '22:00' },
      { name: 'Steakz Madrid', city: 'Madrid', country: 'Spain', timezone: 'Europe/Madrid', address: 'Plaza Mayor', postalCode: '28012', phone: '+34 91 123 4567', email: 'madrid@steakz.example', latitude: 40.4168, longitude: -3.7038, openingTime: '09:00', closingTime: '22:00' }
    ];
    const results = [];
    for (const s of samples) {
      const existing = await prisma.branch.findFirst({ where: { name: s.name, city: s.city } });
      if (existing) {
        results.push({ name: s.name, status: 'skipped', id: existing.id });
      } else {
        const created = await prisma.branch.create({ data: { ...s, location: s.city } });
        results.push({ name: s.name, status: 'created', id: created.id });
      }
    }
    console.info('[Multi-Branch Enhancement] Seed sample branches summary:', results);
    res.json({ summary: results });
  } catch (error) {
    console.error('Seed sample branches error:', error);
    res.status(400).json({ message: 'Error seeding sample branches' });
  }
});

// Multi-Branch Enhancement: Branch settings update (MANAGER/ADMIN only)
app.patch(
  '/api/branches/:id/settings',
  authenticateToken,
  requireRoles(['ADMIN', 'MANAGER']),
  enforceBranchAccess((req) => resolveBranchId(req, req.params.id)),
  async (req, res) => {
    try {
      const branchId = resolveBranchId(req, req.params.id);
      if (Number.isNaN(branchId)) {
        return res.status(400).json({ message: 'Invalid branch id' });
      }

      const allowedFields = ['timezone','latitude','longitude','openingTime','closingTime','holidays','country','city','address','postalCode','phone','email'];
      const data = {};
      for (const key of allowedFields) {
        if (key in req.body) data[key] = req.body[key];
      }

      const updated = await prisma.branch.update({
        where: { id: branchId },
        data
      });
      res.json(updated);
    } catch (error) {
      console.error('Branch settings update error:', error);
      res.status(400).json({ message: 'Error updating branch settings' });
    }
  }
);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Multi-Branch Enhancement: Branch settings retrieval (MANAGER/ADMIN only)
app.get(
  '/api/branches/:id/settings',
  authenticateToken,
  requireRoles(['ADMIN', 'MANAGER']),
  enforceBranchAccess((req) => resolveBranchId(req, req.params.id)),
  async (req, res) => {
    try {
      const branchId = resolveBranchId(req, req.params.id);
      if (Number.isNaN(branchId)) {
        return res.status(400).json({ message: 'Invalid branch id' });
      }
      const branch = await prisma.branch.findUnique({
        where: { id: branchId },
        select: {
          id: true,
          name: true,
          location: true,
          country: true,
          city: true,
          address: true,
          postalCode: true,
          phone: true,
          email: true,
          timezone: true,
          latitude: true,
          longitude: true,
          openingTime: true,
          closingTime: true,
          holidays: true
        }
      });
      if (!branch) return res.status(404).json({ message: 'Branch not found' });
      console.info('[Multi-Branch Enhancement] GET settings for branch', branchId);
      res.json(branch);
    } catch (error) {
      console.error('Branch settings fetch error:', error);
      res.status(400).json({ message: 'Error fetching branch settings' });
    }
  }
);

// ADMIN unified staff creation (User + Staff are same entity)
// Spec: POST /api/admin/staff (ADMIN only)
app.post(
  '/api/admin/staff',
  authenticateToken,
  requireRoles(['ADMIN']),
  async (req, res) => {
    try {
      const { email, password, role, branchId } = req.body;

      if (!email || !password || !role || !branchId) {
        return res.status(400).json({ message: 'Missing required fields: email, password, role, branchId' });
      }

      const allowedRoles = ['MANAGER', 'CHEF', 'STAFF'];
      const normalizedRole = role.toString().toUpperCase();
      if (!allowedRoles.includes(normalizedRole)) {
        return res.status(400).json({ message: `Invalid role. Must be one of: ${allowedRoles.join(', ')}` });
      }

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return res.status(400).json({ message: 'User with this email already exists' });
      }

      const parsedBranchId = parseInt(branchId);
      if (Number.isNaN(parsedBranchId)) {
        return res.status(400).json({ message: 'Invalid branchId' });
      }

      const branch = await prisma.branch.findUnique({ where: { id: parsedBranchId } });
      if (!branch) return res.status(404).json({ message: 'Branch not found' });

      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await prisma.user.create({
        data: { email, password: hashedPassword, role: normalizedRole, branchId: parsedBranchId },
        select: { id: true, email: true, role: true, branchId: true, branch: { select: { id: true, name: true } } }
      });

      res.status(201).json({ message: 'Staff created', user });
    } catch (error) {
      console.error('Admin staff create error:', error);
      res.status(500).json({ message: 'Error creating staff', error: error.message });
    }
  }
);

// ADMIN password reset for staff
// Spec: PATCH /api/admin/staff/:id/reset-password (ADMIN only)
app.patch(
  '/api/admin/staff/:id/reset-password',
  authenticateToken,
  requireRoles(['ADMIN']),
  async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const { password: newPassword } = req.body;
      if (!newPassword || newPassword.length < 3) {
        return res.status(400).json({ message: 'Password must be at least 3 characters' });
      }
      const existing = await prisma.user.findUnique({ where: { id: userId } });
      if (!existing) return res.status(404).json({ message: 'User not found' });
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      const updated = await prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword },
        select: { id: true, email: true, role: true, branchId: true }
      });
      res.json({ message: 'Password reset successfully', user: updated });
    } catch (error) {
      console.error('Admin staff password reset error:', error);
      res.status(500).json({ message: 'Error resetting password', error: error.message });
    }
  }
);

// List staff for a branch (ADMIN/MANAGER can view staff for their branch)
app.get(
  '/api/admin/staff/:branchId',
  authenticateToken,
  requireRoles(['ADMIN', 'MANAGER']),
  async (req, res) => {
    try {
      const branchId = parseInt(req.params.branchId);
      if (Number.isNaN(branchId)) {
        return res.status(400).json({ message: 'Invalid branchId' });
      }

      // CRITICAL: Enforce branch access
      const role = (req.user?.role || '').toUpperCase();
      if (role !== 'ADMIN') {
        const userBranchId = parseInt(req.user?.branchId);
        if (userBranchId !== branchId) {
          return res.status(403).json({ message: 'Branch access denied' });
        }
      }

      // Fetch staff (non-CUSTOMER, non-ADMIN users) for the branch
      // Using raw query to avoid Prisma enum issues with string filtering
      const staff = await prisma.$queryRaw`
        SELECT id, email, role, "branchId", "createdAt"
        FROM "User"
        WHERE "branchId" = ${branchId}
          AND role IN ('MANAGER', 'CHEF', 'STAFF')
        ORDER BY "createdAt" DESC
      `;

      res.json(staff);
    } catch (error) {
      console.error('List staff error:', error);
      res.status(500).json({ message: 'Error fetching staff', error: error.message });
    }
  }
);

// Multi-Branch Enhancement: ADMIN-only staff creation endpoint (create staff with specific role and branch)
app.post(
  '/api/admin/staff/create',
  authenticateToken,
  requireRoles(['ADMIN']),
  async (req, res) => {
    try {
      const { email, password, role, branchId } = req.body;
      
      // Validation
      if (!email || !password || !role || !branchId) {
        return res.status(400).json({
          message: 'Missing required fields: email, password, role, branchId'
        });
      }

      // Validate role enum
      const validRoles = ['ADMIN', 'MANAGER', 'CHEF', 'SERVER', 'HOST', 'BARTENDER', 'RUNNER', 'STAFF', 'CUSTOMER'];
      if (!validRoles.includes(role.toUpperCase())) {
        return res.status(400).json({
          message: `Invalid role. Must be one of: ${validRoles.join(', ')}`
        });
      }

      // Check if user already exists
      const existingUser = await prisma.user.findUnique({
        where: { email }
      });
      if (existingUser) {
        return res.status(400).json({ message: 'User with this email already exists' });
      }

      // Parse branchId as integer
      const parsedBranchId = parseInt(branchId);
      if (Number.isNaN(parsedBranchId)) {
        return res.status(400).json({ message: 'Invalid branchId' });
      }

      // Verify branch exists
      const branch = await prisma.branch.findUnique({
        where: { id: parsedBranchId }
      });
      if (!branch) {
        return res.status(404).json({ message: 'Branch not found' });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user
      const user = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          role: role.toUpperCase(),
          branchId: parsedBranchId
        },
        select: {
          id: true,
          email: true,
          role: true,
          branchId: true,
          branch: {
            select: {
              id: true,
              name: true
            }
          }
        }
      });

      console.info('[RBAC] ADMIN created new staff member:', {
        email: user.email,
        role: user.role,
        branchId: user.branchId
      });

      res.status(201).json({
        message: 'Staff member created successfully',
        user
      });
    } catch (error) {
      console.error('Staff creation error:', error);
      res.status(500).json({
        message: 'Error creating staff member',
        error: error.message
      });
    }
  }
);

// Multi-Branch Enhancement: ADMIN-only general user creation endpoint
app.post(
  '/api/admin/users',
  authenticateToken,
  requireRoles(['ADMIN']),
  async (req, res) => {
    try {
      const { email, password, role, branchId } = req.body;
      
      // Validation
      if (!email || !password || !role || !branchId) {
        return res.status(400).json({
          message: 'Missing required fields: email, password, role, branchId'
        });
      }

      // Only allow specific roles (prevent ADMIN role creation via this endpoint)
      const allowedRoles = ['MANAGER', 'CHEF', 'STAFF'];
      const normalizedRole = role.toString().toUpperCase();
      if (!allowedRoles.includes(normalizedRole)) {
        return res.status(400).json({
          message: `Invalid role. Must be one of: ${allowedRoles.join(', ')}. ADMIN role creation is restricted.`
        });
      }

      // Check if user already exists
      const existingUser = await prisma.user.findUnique({
        where: { email }
      });
      if (existingUser) {
        return res.status(400).json({ message: 'User with this email already exists' });
      }

      // Parse branchId as integer
      const parsedBranchId = parseInt(branchId);
      if (Number.isNaN(parsedBranchId)) {
        return res.status(400).json({ message: 'Invalid branchId' });
      }

      // Verify branch exists
      const branch = await prisma.branch.findUnique({
        where: { id: parsedBranchId }
      });
      if (!branch) {
        return res.status(404).json({ message: 'Branch not found' });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user
      const user = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          role: normalizedRole,
          branchId: parsedBranchId
        },
        select: {
          id: true,
          email: true,
          role: true,
          branchId: true,
          branch: {
            select: {
              id: true,
              name: true
            }
          }
        }
      });

      console.info('[RBAC] ADMIN created new user:', {
        email: user.email,
        role: user.role,
        branchId: user.branchId
      });

      res.status(201).json({
        message: 'User created successfully',
        user
      });
    } catch (error) {
      console.error('User creation error:', error);
      res.status(500).json({
        message: 'Error creating user',
        error: error.message
      });
    }
  }
);

// Multi-Branch Enhancement: ADMIN-only password reset endpoint
app.post(
  '/api/admin/users/:id/reset-password',
  authenticateToken,
  requireRoles(['ADMIN']),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { newPassword } = req.body;

      if (!newPassword || newPassword.length < 3) {
        return res.status(400).json({ message: 'Password must be at least 3 characters' });
      }

      const userId = parseInt(id);
      if (Number.isNaN(userId)) {
        return res.status(400).json({ message: 'Invalid user ID' });
      }

      // Verify user exists
      const user = await prisma.user.findUnique({
        where: { id: userId }
      });
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Update password
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword },
        select: {
          id: true,
          email: true,
          role: true,
          branchId: true
        }
      });

      console.info('[RBAC] ADMIN reset password for user:', {
        userId: updatedUser.id,
        email: updatedUser.email
      });

      res.json({
        message: 'Password reset successfully',
        user: updatedUser
      });
    } catch (error) {
      console.error('Password reset error:', error);
      res.status(500).json({
        message: 'Error resetting password',
        error: error.message
      });
    }
  }
);

// SAFE TEST ONLY / Multi-Branch Enhancement: Activate test routes at end
registerTestRoutes({ app, prisma, authenticateToken }); // SAFE TEST ONLY