import React, { useState, useEffect } from 'react';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

const API_BASE_URL = "http://localhost:3001/api";

function App() {
  const [user, setUser] = useState(null);
  const [activeBranchId, setActiveBranchId] = useState(1);
  const [view, setView] = useState('login');
  const [menuItems, setMenuItems] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [orders, setOrders] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [cart, setCart] = useState([]);

  // Login Persistence
  useEffect(() => {
    const storedUser = localStorage.getItem('steakzUser');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
  }, []);

  // Fetch Data
  useEffect(() => {
    if (user && activeBranchId) {
      fetchInventory();
      fetchOrders();
      fetchReservations();
    }
  }, [user, activeBranchId]);

  const fetchInventory = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/inventory/${activeBranchId}`, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      const data = await response.json();
      setInventory(data);
      setMenuItems(data.map(item => item.menuItem));
    } catch (error) {
      console.error('Error fetching inventory:', error);
    }
  };

  const fetchOrders = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/orders/${activeBranchId}`, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      const data = await response.json();
      setOrders(data);
    } catch (error) {
      console.error('Error fetching orders:', error);
    }
  };

  const fetchReservations = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/reservations/${activeBranchId}`, {
        headers: { Authorization: `Bearer ${user.token}` }
      });
      const data = await response.json();
      setReservations(data);
    } catch (error) {
      console.error('Error fetching reservations:', error);
    }
  };

  const handleLogin = async (email, password) => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        setUser(data);
        localStorage.setItem('steakzUser', JSON.stringify(data));
        setView('menu');
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      toast.error('Login failed');
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('steakzUser');
    setView('login');
  };

  const handleSignup = async (email, password) => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, branchId: activeBranchId })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        toast.success('Signup successful! Please login.');
        setView('login');
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      toast.error('Signup failed');
    }
  };

  const placeOrder = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/orders/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.token}`
        },
        body: JSON.stringify({
          branchId: activeBranchId,
          items: cart.map(item => ({
            menuItemId: item.id,
            quantity: item.quantity,
            price: item.price
          })),
          total: cart.reduce((sum, item) => sum + item.price * item.quantity, 0)
        })
      });

      const data = await response.json();
      
      if (response.ok) {
        toast.success('Order placed successfully!');
        setCart([]);
        fetchOrders();
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      toast.error('Failed to place order');
    }
  };

  const makeReservation = async (date, time, guests, notes) => {
    try {
      const response = await fetch(`${API_BASE_URL}/reservations/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.token}`
        },
        body: JSON.stringify({
          branchId: activeBranchId,
          date,
          time,
          guests,
          notes
        })
      });

      const data = await response.json();
      
      if (response.ok) {
        toast.success('Reservation made successfully!');
        fetchReservations();
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      toast.error('Failed to make reservation');
    }
  };

  const updateInventory = async (itemId, quantity) => {
    if (!['MANAGER', 'ADMIN'].includes(user.role)) {
      toast.error('Unauthorized');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/inventory/${itemId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.token}`
        },
        body: JSON.stringify({ quantity })
      });

      const data = await response.json();
      
      if (response.ok) {
        toast.success('Inventory updated successfully!');
        fetchInventory();
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      toast.error('Failed to update inventory');
    }
  };

  const updateOrderStatus = async (orderId, status) => {
    if (!['STAFF', 'MANAGER', 'ADMIN'].includes(user.role)) {
      toast.error('Unauthorized');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/orders/status/${orderId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user.token}`
        },
        body: JSON.stringify({ status })
      });

      const data = await response.json();
      
      if (response.ok) {
        toast.success('Order status updated!');
        fetchOrders();
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      toast.error('Failed to update order status');
    }
  };

  // Render Functions
  const renderLogin = () => (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-red-600">
            Steakz International
          </h2>
          <p className="mt-2 text-center text-sm text-gray-400">
            Sign in to your account
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.target);
          handleLogin(formData.get('email'), formData.get('password'));
        }}>
          <input type="hidden" name="remember" value="true" />
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <input
                name="email"
                type="email"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-700 bg-gray-800 text-gray-300 rounded-t-md focus:outline-none focus:ring-red-500 focus:border-red-500 focus:z-10 sm:text-sm"
                placeholder="Email address"
              />
            </div>
            <div>
              <input
                name="password"
                type="password"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-700 bg-gray-800 text-gray-300 rounded-b-md focus:outline-none focus:ring-red-500 focus:border-red-500 focus:z-10 sm:text-sm"
                placeholder="Password"
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            >
              Sign in
            </button>
          </div>
        </form>
        <div className="text-center">
          <button
            onClick={() => setView('signup')}
            className="text-sm text-red-600 hover:text-red-500"
          >
            Create new account
          </button>
        </div>
      </div>
    </div>
  );

  const renderSignup = () => (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-red-600">
            Create Account
          </h2>
        </div>
        <form className="mt-8 space-y-6" onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.target);
          handleSignup(formData.get('email'), formData.get('password'));
        }}>
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <input
                name="email"
                type="email"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-700 bg-gray-800 text-gray-300 rounded-t-md focus:outline-none focus:ring-red-500 focus:border-red-500 focus:z-10 sm:text-sm"
                placeholder="Email address"
              />
            </div>
            <div>
              <input
                name="password"
                type="password"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-700 bg-gray-800 text-gray-300 rounded-b-md focus:outline-none focus:ring-red-500 focus:border-red-500 focus:z-10 sm:text-sm"
                placeholder="Password"
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            >
              Create Account
            </button>
          </div>
        </form>
        <div className="text-center">
          <button
            onClick={() => setView('login')}
            className="text-sm text-red-600 hover:text-red-500"
          >
            Back to login
          </button>
        </div>
      </div>
    </div>
  );

  const renderNavbar = () => (
    <nav className="bg-gray-800 shadow-lg">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <span className="text-red-600 text-xl font-bold">Steakz</span>
            </div>
            <div className="hidden md:ml-6 md:flex md:space-x-8">
              {user.role === 'CUSTOMER' && (
                <>
                  <button onClick={() => setView('menu')} className="text-gray-300 hover:text-white px-3 py-2">Menu</button>
                  <button onClick={() => setView('orders')} className="text-gray-300 hover:text-white px-3 py-2">Orders</button>
                  <button onClick={() => setView('reservations')} className="text-gray-300 hover:text-white px-3 py-2">Reservations</button>
                </>
              )}
              {['STAFF', 'MANAGER', 'ADMIN'].includes(user.role) && (
                <>
                  <button onClick={() => setView('orders')} className="text-gray-300 hover:text-white px-3 py-2">Orders</button>
                  <button onClick={() => setView('reservations')} className="text-gray-300 hover:text-white px-3 py-2">Reservations</button>
                </>
              )}
              {['MANAGER', 'ADMIN'].includes(user.role) && (
                <button onClick={() => setView('inventory')} className="text-gray-300 hover:text-white px-3 py-2">Inventory</button>
              )}
            </div>
          </div>
          <div className="flex items-center">
            {['MANAGER', 'ADMIN'].includes(user.role) && (
              <select
                value={activeBranchId}
                onChange={(e) => setActiveBranchId(Number(e.target.value))}
                className="mr-4 bg-gray-700 text-white rounded"
              >
                <option value={1}>Branch A (NY)</option>
                <option value={2}>Branch B (UK)</option>
              </select>
            )}
            <button
              onClick={handleLogout}
              className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    </nav>
  );

  const renderContent = () => {
    if (!user) {
      return view === 'login' ? renderLogin() : renderSignup();
    }

    return (
      <div className="min-h-screen bg-gray-900">
        {renderNavbar()}
        <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
          {view === 'menu' && renderMenu()}
          {view === 'orders' && renderOrders()}
          {view === 'reservations' && renderReservations()}
          {view === 'inventory' && renderInventory()}
        </main>
      </div>
    );
  };

  const renderMenu = () => (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold text-red-600">Menu</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {menuItems.map((item) => (
          <div key={item.id} className="bg-gray-800 p-6 rounded-lg shadow">
            <h3 className="text-xl font-semibold text-white">{item.name}</h3>
            <p className="text-gray-400 mt-2">{item.description}</p>
            <p className="text-red-600 font-bold mt-2">${item.price.toFixed(2)}</p>
            <button
              onClick={() => setCart([...cart, { ...item, quantity: 1 }])}
              className="mt-4 bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
            >
              Add to Cart
            </button>
          </div>
        ))}
      </div>
      {cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-gray-800 p-4">
          <div className="max-w-7xl mx-auto flex justify-between items-center">
            <div className="text-white">
              {cart.length} items | Total: ${cart.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2)}
            </div>
            <button
              onClick={placeOrder}
              className="bg-red-600 text-white px-6 py-2 rounded hover:bg-red-700"
            >
              Place Order
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const renderOrders = () => (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold text-red-600">Orders</h2>
      <div className="space-y-4">
        {orders.map((order) => (
          <div key={order.id} className="bg-gray-800 p-6 rounded-lg shadow">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-white font-semibold">Order #{order.id}</p>
                <p className="text-gray-400">Status: {order.status}</p>
                <p className="text-gray-400">Total: ${order.total.toFixed(2)}</p>
              </div>
              {['STAFF', 'MANAGER', 'ADMIN'].includes(user.role) && (
                <select
                  value={order.status}
                  onChange={(e) => updateOrderStatus(order.id, e.target.value)}
                  className="bg-gray-700 text-white rounded"
                >
                  <option value="PENDING">Pending</option>
                  <option value="PREPARING">Preparing</option>
                  <option value="READY">Ready</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              )}
            </div>
            <div className="mt-4">
              {order.items.map((item) => (
                <div key={item.id} className="text-gray-400">
                  {item.quantity}x {item.menuItem.name} - ${item.price.toFixed(2)}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderReservations = () => (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold text-red-600">Reservations</h2>
      {user.role === 'CUSTOMER' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            makeReservation(
              formData.get('date'),
              formData.get('time'),
              Number(formData.get('guests')),
              formData.get('notes')
            );
          }}
          className="bg-gray-800 p-6 rounded-lg shadow space-y-4"
        >
          <div>
            <label className="block text-gray-400">Date</label>
            <input
              type="date"
              name="date"
              required
              className="mt-1 block w-full rounded bg-gray-700 text-white"
            />
          </div>
          <div>
            <label className="block text-gray-400">Time</label>
            <input
              type="time"
              name="time"
              required
              className="mt-1 block w-full rounded bg-gray-700 text-white"
            />
          </div>
          <div>
            <label className="block text-gray-400">Number of Guests</label>
            <input
              type="number"
              name="guests"
              min="1"
              required
              className="mt-1 block w-full rounded bg-gray-700 text-white"
            />
          </div>
          <div>
            <label className="block text-gray-400">Special Notes</label>
            <textarea
              name="notes"
              className="mt-1 block w-full rounded bg-gray-700 text-white"
            />
          </div>
          <button
            type="submit"
            className="w-full bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
          >
            Make Reservation
          </button>
        </form>
      )}
      <div className="space-y-4">
        {reservations.map((reservation) => (
          <div key={reservation.id} className="bg-gray-800 p-6 rounded-lg shadow">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-white font-semibold">
                  Reservation #{reservation.id}
                </p>
                <p className="text-gray-400">
                  Date: {new Date(reservation.date).toLocaleDateString()}
                </p>
                <p className="text-gray-400">Time: {reservation.time}</p>
                <p className="text-gray-400">Guests: {reservation.guests}</p>
                <p className="text-gray-400">Status: {reservation.status}</p>
                {reservation.notes && (
                  <p className="text-gray-400">Notes: {reservation.notes}</p>
                )}
              </div>
              {['STAFF', 'MANAGER', 'ADMIN'].includes(user.role) && (
                <select
                  value={reservation.status}
                  onChange={(e) =>
                    updateReservationStatus(reservation.id, e.target.value)
                  }
                  className="bg-gray-700 text-white rounded"
                >
                  <option value="PENDING">Pending</option>
                  <option value="CONFIRMED">Confirmed</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderInventory = () => (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold text-red-600">Inventory</h2>
      <div className="space-y-4">
        {inventory.map((item) => (
          <div key={item.id} className="bg-gray-800 p-6 rounded-lg shadow">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-white font-semibold">{item.menuItem.name}</p>
                <p className="text-gray-400">
                  Current Quantity: {item.quantity}
                </p>
                <p className="text-gray-400">
                  Min Quantity: {item.minQuantity}
                </p>
                {item.quantity < item.minQuantity && (
                  <p className="text-red-500">Low Stock!</p>
                )}
              </div>
              {['MANAGER', 'ADMIN'].includes(user.role) && (
                <div className="flex items-center space-x-2">
                  <input
                    type="number"
                    min="0"
                    value={item.quantity}
                    onChange={(e) =>
                      updateInventory(item.id, Number(e.target.value))
                    }
                    className="w-20 bg-gray-700 text-white rounded px-2 py-1"
                  />
                  <button
                    onClick={() => updateInventory(item.id, item.quantity + 10)}
                    className="bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700"
                  >
                    +10
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <>
      {renderContent()}
      <ToastContainer position="bottom-right" theme="dark" />
    </>
  );
}

export default App;