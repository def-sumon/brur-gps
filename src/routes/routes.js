const express = require('express');
const router = express.Router();
const Route = require('../models/Route');
const Bus = require('../models/Bus');

// GET /api/routes - all active routes
router.get('/', async (req, res) => {
  try {
    const routes = await Route.find({ isActive: true }).lean();
    res.json({ success: true, data: routes, count: routes.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/routes/:id - single route with stops
router.get('/:id', async (req, res) => {
  try {
    const route = await Route.findById(req.params.id).lean();
    if (!route) return res.status(404).json({ success: false, error: 'Route not found' });
    res.json({ success: true, data: route });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/routes - create route (admin)
router.post('/', async (req, res) => {
  try {
    const route = new Route(req.body);
    await route.save();
    res.status(201).json({ success: true, data: route });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// PUT /api/routes/:id - update route
router.put('/:id', async (req, res) => {
  try {
    const route = await Route.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!route) return res.status(404).json({ success: false, error: 'Route not found' });
    res.json({ success: true, data: route });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// DELETE /api/routes/:id - soft delete
router.delete('/:id', async (req, res) => {
  try {
    const route = await Route.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!route) return res.status(404).json({ success: false, error: 'Route not found' });
    res.json({ success: true, message: 'Route deactivated' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/routes/seed/brur - seed BRUR routes
router.post('/seed/brur', async (req, res) => {
  try {
    const brurRoutes = [
      {
        name: 'মেডিকেল - ক্যাম্পাস',
        description: 'Rangpur Medical College to BRUR Campus',
        color: '#1565C0',
        stops: [
          { name: 'রংপুর মেডিকেল', latitude: 25.7431, longitude: 89.2583, order: 1, isTerminal: true },
          { name: 'কেন্দ্রীয় বাস টার্মিনাল', latitude: 25.7401, longitude: 89.2612, order: 2 },
          { name: 'বিআরটিসি', latitude: 25.7411, longitude: 89.2651, order: 3 },
          { name: 'শাপলা চত্বর', latitude: 25.7439, longitude: 89.2752, order: 4, isTerminal: true },
        ],
      },
      {
        name: 'শহর - ক্যাম্পাস',
        description: 'Rangpur City to BRUR Campus',
        color: '#2E7D32',
        stops: [
          { name: 'রংপুর কোর্ট', latitude: 25.7369, longitude: 89.2546, order: 1, isTerminal: true },
          { name: 'জাহাজ কোম্পানি মোড়', latitude: 25.7385, longitude: 89.2601, order: 2 },
          { name: 'সিটি কলেজ', latitude: 25.7419, longitude: 89.2689, order: 3 },
          { name: 'বিশ্ববিদ্যালয় গেট', latitude: 25.7452, longitude: 89.2773, order: 4, isTerminal: true },
        ],
      },
      {
        name: 'পার্ক - ক্যাম্পাস',
        description: 'Rangpur Park to BRUR Campus',
        color: '#6A1B9A',
        stops: [
          { name: 'রংপুর পার্ক', latitude: 25.7355, longitude: 89.2498, order: 1, isTerminal: true },
          { name: 'মডার্ন মোড়', latitude: 25.7378, longitude: 89.2547, order: 2 },
          { name: 'নিউ মার্কেট', latitude: 25.7395, longitude: 89.2612, order: 3 },
          { name: 'ক্যাম্পাস গেট', latitude: 25.7452, longitude: 89.2773, order: 4, isTerminal: true },
        ],
      },
    ];

    await Route.deleteMany({});
    const created = await Route.insertMany(brurRoutes);
    res.status(201).json({ success: true, message: `${created.length} BRUR routes seeded`, data: created });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/buses - all registered buses
router.get('/buses/all', async (req, res) => {
  try {
    const buses = await Bus.find({ isActive: true }).populate('routeId').lean();
    res.json({ success: true, data: buses, count: buses.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/buses/register - register a bus
router.post('/buses/register', async (req, res) => {
  try {
    const bus = new Bus(req.body);
    await bus.save();
    res.status(201).json({ success: true, data: bus });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// PUT /api/buses/:id - update bus info
router.put('/buses/:id', async (req, res) => {
  try {
    const bus = await Bus.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!bus) return res.status(404).json({ success: false, error: 'Bus not found' });
    res.json({ success: true, data: bus });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
