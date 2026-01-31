// @ts-check
/**
 * Reusable RBAC utilities with branch-level enforcement.
 * Admins bypass branch checks; all other roles are locked to their branchId/activeBranchId.
 * These helpers are intentionally framework-light to fit the existing Express setup.
 */

/** @typedef {'ADMIN' | 'MANAGER' | 'CHEF' | 'STAFF' | 'CUSTOMER'} Role */

/**
 * @typedef {Object} User
 * @property {Role} role
 * @property {number} [branchId]
 */

/**
 * @typedef {import('express').Request & { user?: User, activeBranchId?: number }} ExtendedRequest
 */

/** Normalizes unknown roles to uppercase strings */
const normalizeRole = (/** @type {any} */ role) => (role || '').toString().toUpperCase();

/**
 * requireRoles middleware factory.
 * @param {Role[]} allowedRoles
 * @returns {import('express').RequestHandler}
 */
const requireRoles = (allowedRoles = []) => {
  const allowed = allowedRoles.map(normalizeRole);
  return (/** @type {ExtendedRequest} */ req, res, next) => {
    const role = normalizeRole(req.user?.role);
    if (!role) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }
    if (!allowed.includes(role)) {
      res.status(403).json({ message: `Access denied: role ${role} requires ${allowed.join(', ')}` });
      return;
    }
    next();
  };
};

/**
 * Extracts the branch id for the current user, preferring persisted branchId then activeBranchId fallback.
 * @param {ExtendedRequest} req
 */
const getUserBranchId = (req) => {
  const userBranch = req.user?.branchId;
  const activeBranch = req.activeBranchId;
  const resolved = userBranch ?? activeBranch;
  return resolved != null ? Number(resolved) : null;
};

/**
 * enforceBranchAccess middleware factory.
 * ADMIN can switch active branch but is still scoped to that branch.
 * Non-admins are always locked to their assigned branch.
 * @param {number | ((req: ExtendedRequest) => number | Promise<number | null>) | null} resolver
 * @returns {import('express').RequestHandler}
 */
const enforceBranchAccess = (resolver) => {
  return async (/** @type {ExtendedRequest} */ req, res, next) => {
    try {
      const role = normalizeRole(req.user?.role);
      if (!role) {
        res.status(401).json({ message: 'Authentication required' });
        return;
      }

      // ADMIN: allow access to any requested branch; other roles locked to their branch
      if (role === 'ADMIN') {
        return next();
      }

      // Resolve effective branch for non-admins (locked to their assigned branch)
      const userBranchId = req.user?.branchId;

      const resolved = typeof resolver === 'function' ? await resolver(req) : resolver;
      const resourceBranchId = resolved != null ? Number(resolved) : null;

      if (!resourceBranchId) {
        res.status(400).json({ message: 'Branch context required' });
        return;
      }
      if (!userBranchId) {
        res.status(403).json({ message: 'Branch access denied: no active branch' });
        return;
      }
      if (Number(resourceBranchId) !== Number(userBranchId)) {
        res.status(403).json({ message: `Branch access denied: resource branch ${resourceBranchId} does not match active branch ${userBranchId}` });
        return;
      }
      next();
    } catch (err) {
      console.error('enforceBranchAccess error', err);
      res.status(500).json({ message: 'Branch enforcement failed' });
    }
  };
};

/**
 * CHEF-specific access enforcement.
 * CHEF role is strictly limited to:
 * - Their assigned branch ONLY (no branch switching)
 * - Orders endpoints (read status + update status only)
 * 
 * CHEF cannot access: staff, inventory, analytics, feedback, reservations
 * 
 * @returns {import('express').RequestHandler}
 */
const requireChefOrdersOnly = () => {
  return (/** @type {ExtendedRequest} */ req, res, next) => {
    const role = normalizeRole(req.user?.role);
    
    // Only CHEF needs this special check
    if (role !== 'CHEF') {
      next();
      return;
    }

    // CHEF is locked to their assigned branch (no switching allowed)
    if (!req.user?.branchId) {
      res.status(403).json({ message: 'CHEF: Branch assignment required' });
      return;
    }

    // Ignore any activeBranchId switching attempts for CHEF
    req.activeBranchId = req.user.branchId;
    next();
  };
};

/**
 * Block CHEF from non-Orders endpoints.
 * Used on staff, inventory, feedback, reservations, analytics routes.
 * @returns {import('express').RequestHandler}
 */
const blockChefFromNonOrders = () => {
  return (/** @type {ExtendedRequest} */ req, res, next) => {
    const role = normalizeRole(req.user?.role);
    if (role === 'CHEF') {
      res.status(403).json({ message: 'CHEF role can only access Orders. Access denied.' });
      return;
    }
    next();
  };
};

module.exports = {
  requireRoles,
  enforceBranchAccess,
  requireChefOrdersOnly,
  blockChefFromNonOrders,
};
