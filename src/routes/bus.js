const express = require('express');
const router = express.Router();
const Location = require('../models/Location');
const Bus = require('../models/Bus');
const { optionalAuthenticate } = require('../middleware/auth');

// Haversine distance in km
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// GET /api/bus/all - all active buses with enriched info from Bus model
router.get('/all', optionalAuthenticate, async (req, res) => {
  try {
    const { maxAge = 300 } = req.query;
    const cutoffTime = new Date(Date.now() - maxAge * 1000 * 10);

    const recentDevices = await Location.aggregate([
      { $match: { time: { $gte: cutoffTime } } },
      { $sort: { time: -1 } },
      { $group: { _id: '$deviceId', latestLocation: { $first: '$$ROOT' } } },
    ]);

    const registeredBuses = await Bus.find({ isActive: true }).lean();
    const busMap = {};
    registeredBuses.forEach(b => { busMap[b.deviceId] = b; });

    const buses = recentDevices.map(device => {
      const info = busMap[device._id] || {};
      return {
        busId: device._id,
        deviceId: device._id,
        name: info.name || `Bus ${device._id.slice(-4)}`,
        route: info.routeName || 'BRUR Campus',
        plateNumber: info.plateNumber || '',
        color: info.color || '#1565C0',
        location: {
          lat: device.latestLocation.latitude,
          lng: device.latestLocation.longitude,
        },
        speed: device.latestLocation.speed || 0,
        satellites: device.latestLocation.satellites || 0,
        lastUpdated: device.latestLocation.time,
        isActive: true,
      };
    });

    res.json({ success: true, data: { buses, count: buses.length } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch buses' });
  }
});

// GET /api/bus/:busId/location - single bus location
router.get('/:busId/location', optionalAuthenticate, async (req, res) => {
  try {
    const { busId } = req.params;
    const location = await Location.findOne({ deviceId: busId }).sort({ time: -1 }).lean();

    if (!location) {
      return res.status(404).json({ success: false, error: 'Bus not found or no location data' });
    }

    const busInfo = await Bus.findOne({ deviceId: busId }).lean();

    res.json({
      success: true,
      data: {
        busId: location.deviceId,
        deviceId: location.deviceId,
        name: busInfo?.name || `Bus ${location.deviceId.slice(-4)}`,
        route: busInfo?.routeName || 'BRUR Campus',
        plateNumber: busInfo?.plateNumber || '',
        color: busInfo?.color || '#1565C0',
        location: { lat: location.latitude, lng: location.longitude },
        speed: location.speed || 0,
        satellites: location.satellites || 0,
        locationType: location.locationType || 'gps',
        lastUpdated: location.time,
        isActive: true,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch bus location' });
  }
});

// GET /api/bus/:busId/eta?lat=&lng= - calculate ETA to user location
router.get('/:busId/eta', optionalAuthenticate, async (req, res) => {
  try {
    const { busId } = req.params;
    const { lat, lng } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ success: false, error: 'lat and lng query params required' });
    }

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);

    if (isNaN(userLat) || isNaN(userLng)) {
      return res.status(400).json({ success: false, error: 'Invalid lat/lng values' });
    }

    const location = await Location.findOne({ deviceId: busId }).sort({ time: -1 }).lean();

    if (!location) {
      return res.status(404).json({ success: false, error: 'Bus not found' });
    }

    const distanceKm = haversineDistance(
      location.latitude, location.longitude,
      userLat, userLng
    );

    const speed = location.speed || 0;
    const isMoving = speed > 2;
    let etaMinutes = null;
    if (isMoving) {
      etaMinutes = Math.ceil((distanceKm / speed) * 60);
    }

    res.json({
      success: true,
      data: {
        distanceKm: parseFloat(distanceKm.toFixed(2)),
        speedKmh: speed,
        etaMinutes,
        isMoving,
        busLocation: { lat: location.latitude, lng: location.longitude },
        lastUpdated: location.time,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to calculate ETA' });
  }
});

// GET /api/bus/:busId/history - route history
router.get('/:busId/history', optionalAuthenticate, async (req, res) => {
  try {
    const { busId } = req.params;
    const { duration = 60, limit = 100 } = req.query;
    const startTime = new Date(Date.now() - duration * 60 * 1000);

    const locations = await Location
      .find({ deviceId: busId, time: { $gte: startTime } })
      .sort({ time: 1 })
      .limit(parseInt(limit))
      .lean();

    const points = locations.map(loc => ({
      latitude: loc.latitude,
      longitude: loc.longitude,
      speed: loc.speed || 0,
      satellites: loc.satellites || 0,
      timestamp: loc.time,
    }));

    res.json({
      success: true,
      data: { busId, points, count: points.length, duration: parseInt(duration) },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch bus history' });
  }
});

// GET /api/bus/devices - all registered devices
router.get('/devices', optionalAuthenticate, async (req, res) => {
  try {
    const devices = await Location.distinct('deviceId');
    const registeredBuses = await Bus.find({ isActive: true }).lean();
    const busMap = {};
    registeredBuses.forEach(b => { busMap[b.deviceId] = b; });

    const result = await Promise.all(
      devices.map(async (deviceId) => {
        const location = await Location.findOne({ deviceId }).sort({ time: -1 }).lean();
        const busInfo = busMap[deviceId] || {};
        return {
          deviceId,
          busId: deviceId,
          name: busInfo.name || `Bus ${deviceId.slice(-4)}`,
          route: busInfo.routeName || 'BRUR Campus',
          lastSeen: location?.time,
          location: location ? { lat: location.latitude, lng: location.longitude } : null,
          speed: location?.speed || 0,
          isActive: location && (Date.now() - new Date(location.time).getTime() < 300000),
        };
      })
    );

    res.json({ success: true, data: { buses: result, count: result.length } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch devices' });
  }
});

// GET /api/bus/:busId/stats - bus statistics
router.get('/:busId/stats', optionalAuthenticate, async (req, res) => {
  try {
    const { busId } = req.params;
    const { hours = 24 } = req.query;
    const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);

    const locations = await Location.find({ deviceId: busId, time: { $gte: startTime } }).sort({ time: 1 }).lean();

    if (!locations.length) {
      return res.status(404).json({ success: false, error: 'No data found for this period' });
    }

    const speeds = locations.map(l => l.speed || 0);
    const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    const maxSpeed = Math.max(...speeds);
    const totalDistance = locations.reduce((total, loc, i) => {
      if (i === 0) return 0;
      const prev = locations[i - 1];
      return total + haversineDistance(prev.latitude, prev.longitude, loc.latitude, loc.longitude);
    }, 0);

    res.json({
      success: true,
      data: {
        busId,
        statistics: {
          totalPoints: locations.length,
          averageSpeed: Math.round(avgSpeed * 10) / 10,
          maxSpeed: Math.round(maxSpeed * 10) / 10,
          estimatedDistanceKm: Math.round(totalDistance * 10) / 10,
          firstUpdate: locations[0].time,
          lastUpdate: locations[locations.length - 1].time,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch bus statistics' });
  }
});

// POST /api/bus/:busId/location - manual location update
router.post('/:busId/location', async (req, res) => {
  try {
    const { busId } = req.params;
    const { latitude, longitude, speed, satellites, locationType } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({ success: false, error: 'latitude and longitude required' });
    }

    const location = new Location({
      deviceId: busId,
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      speed: parseFloat(speed) || 0,
      satellites: parseInt(satellites) || 0,
      locationType: locationType || 'manual',
      time: new Date(),
    });

    await location.save();

    const io = req.app.get('io');
    if (io) {
      const busInfo = await Bus.findOne({ deviceId: busId }).lean();
      const payload = {
        busId,
        deviceId: busId,
        name: busInfo?.name || `Bus ${busId.slice(-4)}`,
        route: busInfo?.routeName || 'BRUR Campus',
        location: { lat: latitude, lng: longitude },
        speed: location.speed,
        lastUpdated: location.time,
        isActive: true,
      };
      io.emit('bus-location-update', payload);
      io.to(`bus-${busId}`).emit('bus-location-update', payload);
    }

    res.json({ success: true, message: 'Location updated', data: { location } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update location' });
  }
});

module.exports = router;
