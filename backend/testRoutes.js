// SAFE TEST ONLY / Multi-Branch Enhancement
// Additive test routes for branch-specific pricing, inventory, and staff.
// These routes live under /api/test/* and are restricted to MANAGER/ADMIN roles.
// MANAGER scope is limited to their own branch (req.user.branchId).

module.exports = function registerTestRoutes({ app, prisma, authenticateToken }) {
  // Helper: role guard
  const requireManagerOrAdmin = (req, res) => {
    if (!['MANAGER', 'ADMIN'].includes(req.user?.role)) {
      res.status(403).json({ message: 'Unauthorized (MANAGER/ADMIN only)' });
      return false;
    }
    return true;
  };

  // Helper: branch scoping for MANAGER
  function resolveScopedBranchId(req, paramBranchId) {
    const requested = parseInt(paramBranchId);
    if (Number.isNaN(requested)) return { error: 'Invalid branch id' };
    if (req.user.role === 'ADMIN') return { branchId: requested };
    // MANAGER: force to their own branch
    if (req.user.role === 'MANAGER') {
      if (requested !== req.user.branchId) {
        return { error: 'Managers can only access their own branch' };
      }
      return { branchId: req.user.branchId };
    }
    return { error: 'Unauthorized role' };
  }

  // ---------------- BranchPrice (test) ----------------
  app.get('/api/test/branches/:branchId/prices', authenticateToken, async (req, res) => {
    if (!requireManagerOrAdmin(req, res)) return;
    const scope = resolveScopedBranchId(req, req.params.branchId);
    if (scope.error) return res.status(403).json({ message: scope.error });
    try {
      const list = await prisma.branchPrice.findMany({
        where: { branchId: scope.branchId },
        include: { menuItem: true }
      });
      res.json(list);
    } catch (e) {
      console.error('[TEST] List prices error', e);
      res.status(400).json({ message: 'Error fetching test prices' });
    }
  });

  app.post('/api/test/branches/:branchId/prices', authenticateToken, async (req, res) => {
    if (!requireManagerOrAdmin(req, res)) return;
    const scope = resolveScopedBranchId(req, req.params.branchId);
    if (scope.error) return res.status(403).json({ message: scope.error });
    try {
      const { menuItemId, overridePrice, currency, active = true, notes } = req.body;
      if (!menuItemId || typeof overridePrice !== 'number') {
        return res.status(400).json({ message: 'menuItemId and numeric overridePrice are required' });
      }
      const upserted = await prisma.branchPrice.upsert({
        where: { branchId_menuItemId: { branchId: scope.branchId, menuItemId } },
        create: { branchId: scope.branchId, menuItemId, overridePrice, currency, active, notes },
        update: { overridePrice, currency, active, notes }
      });
      res.json(upserted);
    } catch (e) {
      console.error('[TEST] Create/update price error', e);
      res.status(400).json({ message: 'Error creating/updating test price' });
    }
  });

  app.patch('/api/test/prices/:id', authenticateToken, async (req, res) => {
    if (!requireManagerOrAdmin(req, res)) return;
    try {
      const id = parseInt(req.params.id);
      const existing = await prisma.branchPrice.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ message: 'Not found' });
      if (req.user.role === 'MANAGER' && existing.branchId !== req.user.branchId) {
        return res.status(403).json({ message: 'Managers can only modify their own branch data' });
      }
      const { overridePrice, currency, active, notes } = req.body;
      const updated = await prisma.branchPrice.update({
        where: { id },
        data: { overridePrice, currency, active, notes }
      });
      res.json(updated);
    } catch (e) {
      console.error('[TEST] Update price error', e);
      res.status(400).json({ message: 'Error updating test price' });
    }
  });

  app.delete('/api/test/prices/:id', authenticateToken, async (req, res) => {
    if (!requireManagerOrAdmin(req, res)) return;
    try {
      const id = parseInt(req.params.id);
      const existing = await prisma.branchPrice.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ message: 'Not found' });
      if (req.user.role === 'MANAGER' && existing.branchId !== req.user.branchId) {
        return res.status(403).json({ message: 'Managers can only modify their own branch data' });
      }
      await prisma.branchPrice.delete({ where: { id } });
      res.json({ message: 'Deleted' });
    } catch (e) {
      console.error('[TEST] Delete price error', e);
      res.status(400).json({ message: 'Error deleting test price' });
    }
  });

  // ---------------- BranchInventory (test) ----------------
  app.get('/api/test/branches/:branchId/inventory', authenticateToken, async (req, res) => {
    if (!requireManagerOrAdmin(req, res)) return;
    const scope = resolveScopedBranchId(req, req.params.branchId);
    if (scope.error) return res.status(403).json({ message: scope.error });
    try {
      const list = await prisma.branchInventory.findMany({
        where: { branchId: scope.branchId },
        include: { menuItem: true }
      });
      res.json(list);
    } catch (e) {
      console.error('[TEST] List inventory error', e);
      res.status(400).json({ message: 'Error fetching test inventory' });
    }
  });

  app.post('/api/test/branches/:branchId/inventory', authenticateToken, async (req, res) => {
    if (!requireManagerOrAdmin(req, res)) return;
    const scope = resolveScopedBranchId(req, req.params.branchId);
    if (scope.error) return res.status(403).json({ message: scope.error });
    try {
      const { name, menuItemId = null, quantity = 0, minQuantity = 10, unit = null, status = null, notes = null } = req.body;
      if (!name && !menuItemId) return res.status(400).json({ message: 'name or menuItemId required' });
      const created = await prisma.branchInventory.create({
        data: { branchId: scope.branchId, name: name || 'Linked Item', menuItemId, quantity, minQuantity, unit, status, notes }
      });
      res.json(created);
    } catch (e) {
      console.error('[TEST] Create inventory error', e);
      res.status(400).json({ message: 'Error creating test inventory' });
    }
  });

  app.patch('/api/test/inventory/:id', authenticateToken, async (req, res) => {
    if (!requireManagerOrAdmin(req, res)) return;
    try {
      const id = parseInt(req.params.id);
      const existing = await prisma.branchInventory.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ message: 'Not found' });
      if (req.user.role === 'MANAGER' && existing.branchId !== req.user.branchId) {
        return res.status(403).json({ message: 'Managers can only modify their own branch data' });
      }
      const { name, quantity, minQuantity, unit, status, notes } = req.body;
      const updated = await prisma.branchInventory.update({
        where: { id },
        data: { name, quantity, minQuantity, unit, status, notes }
      });
      res.json(updated);
    } catch (e) {
      console.error('[TEST] Update inventory error', e);
      res.status(400).json({ message: 'Error updating test inventory' });
    }
  });

  app.delete('/api/test/inventory/:id', authenticateToken, async (req, res) => {
    if (!requireManagerOrAdmin(req, res)) return;
    try {
      const id = parseInt(req.params.id);
      const existing = await prisma.branchInventory.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ message: 'Not found' });
      if (req.user.role === 'MANAGER' && existing.branchId !== req.user.branchId) {
        return res.status(403).json({ message: 'Managers can only modify their own branch data' });
      }
      await prisma.branchInventory.delete({ where: { id } });
      res.json({ message: 'Deleted' });
    } catch (e) {
      console.error('[TEST] Delete inventory error', e);
      res.status(400).json({ message: 'Error deleting test inventory' });
    }
  });

  // ---------------- Staff (test) ----------------
  app.get('/api/test/branches/:branchId/staff', authenticateToken, async (req, res) => {
    if (!requireManagerOrAdmin(req, res)) return;
    const scope = resolveScopedBranchId(req, req.params.branchId);
    if (scope.error) return res.status(403).json({ message: scope.error });
    try {
      const list = await prisma.staff.findMany({ where: { branchId: scope.branchId } });
      res.json(list);
    } catch (e) {
      console.error('[TEST] List staff error', e);
      res.status(400).json({ message: 'Error fetching test staff' });
    }
  });

  app.post('/api/test/branches/:branchId/staff', authenticateToken, async (req, res) => {
    if (!requireManagerOrAdmin(req, res)) return;
    const scope = resolveScopedBranchId(req, req.params.branchId);
    if (scope.error) return res.status(403).json({ message: scope.error });
    try {
      const { name, role, email = null, phone = null, active = true, hourlyRate = null, notes = null } = req.body;
      if (!name || !role) return res.status(400).json({ message: 'name and role are required' });
      const created = await prisma.staff.create({ data: { branchId: scope.branchId, name, role, email, phone, active, hourlyRate, notes } });
      res.json(created);
    } catch (e) {
      console.error('[TEST] Create staff error', e);
      res.status(400).json({ message: 'Error creating test staff' });
    }
  });

  app.patch('/api/test/staff/:id', authenticateToken, async (req, res) => {
    if (!requireManagerOrAdmin(req, res)) return;
    try {
      const id = parseInt(req.params.id);
      const existing = await prisma.staff.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ message: 'Not found' });
      if (req.user.role === 'MANAGER' && existing.branchId !== req.user.branchId) {
        return res.status(403).json({ message: 'Managers can only modify their own branch data' });
      }
      const { name, role, email, phone, active, hourlyRate, notes } = req.body;
      const updated = await prisma.staff.update({ where: { id }, data: { name, role, email, phone, active, hourlyRate, notes } });
      res.json(updated);
    } catch (e) {
      console.error('[TEST] Update staff error', e);
      res.status(400).json({ message: 'Error updating test staff' });
    }
  });

  app.delete('/api/test/staff/:id', authenticateToken, async (req, res) => {
    if (!requireManagerOrAdmin(req, res)) return;
    try {
      const id = parseInt(req.params.id);
      const existing = await prisma.staff.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ message: 'Not found' });
      if (req.user.role === 'MANAGER' && existing.branchId !== req.user.branchId) {
        return res.status(403).json({ message: 'Managers can only modify their own branch data' });
      }
      await prisma.staff.delete({ where: { id } });
      res.json({ message: 'Deleted' });
    } catch (e) {
      console.error('[TEST] Delete staff error', e);
      res.status(400).json({ message: 'Error deleting test staff' });
    }
  });
};
